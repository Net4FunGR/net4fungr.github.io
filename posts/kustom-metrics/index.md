# K~ustom Metrics in Kentik NMS

---
## Intro

Since the launch of Kentik NMS, it it is possible to ingest and display custom metrics in the Portal. In this post we will be going over a walkthrough of how we can enable Kentik&#39;s Universal Agent to poll custom SNMP and Streaming Telemetry metrics from devices and report them back to the Portal. The use case is about having visibility into BGP Flowspec counters to see what our mitigations are reporting on the devices. 

We are going to address this through SNMP as well as ST for both Junos and IOS-XR devices. For Junos, the flowspec rules are translated into firewall filters which have counters and policers depending on the action. We have two possible ways to extract those, either via SNMP or via streaming telemetry and we are going to use both. For IOS-XR, on the other-hand, there are no SNMP flowspec related OIDs, but there is a dedicated flowspec YANG model we can use to extract the counters via streaming telemetry.

The various tools and device versions used throughout the use case are listed below:
- Kentik kagent docker container
- snmpwalk and snmptable
- gnmic
- Junos vMX on 21.3R1.9
- Cisco IOS-XRv 9000 on 7.9.1

You may find all relevant files in my [repo](https://github.com/becos76/kentik-custom-metrics).

---
## Kentik Universal Agent (kagent)

In order to use the custom metrics feature on the kagent we need some local configuration to be picked up by the agent on startup so it can be processed. In summary, we need three configuration files to exist localy in a specific directory structure that we can call the _override_ directory. 

Below is the structure along with a brief explanation on the purpose of each one.
```Bash
/opt/kentik/components/ranger/local/
└── config
    ├── profiles        # Holds the configuration yaml files for &#39;binding&#39; the sources to specific &#39;device&#39; types
    ├── reports         # Holds the configuration yaml files for &#39;how&#39; we want to report what is collected from the sources in the portal
    └── sources         # Holds the configuration yaml files for &#39;what&#39; we want to poll from the device
```

So once kagent starts it looks for the `local` folder and it processes those files in the structure. For example, if we want to poll an SNMP OID for a device, we would need to create a configuration file under the `sources` directory specifying which OID to poll and how often. Then we need to _bind_ this source to only get polled if say the device is of a specific sysObjectID, and we do that in the `profiles` directory. Lastly, in the `reports` directory we define the path to present the data in the portal, how the data is represented and polled from the MIB, i.e. metrics or dimensions, and how often to update the values in the database. Additionally, in the `reports` directory we can use `starlark` scripts to add additional logic to our reporting capabilities.

### Kagent container

We are going to be running our kagent instance as a container through compose. Here is how our directory structure looks like:
```Bash
/opt/dev/kentik/
├── docker-compose.yml     # How to bring up the container
├── kagent-data            # Local dir mount so kagent data persists -&gt; /opt/kentik in the container
└── override-data          # Local overrides directory with custom definitions -&gt; /opt/kentik/components/ranger/local in the container
    └── config
        ├── profiles
        ├── reports
        └── sources
```

And here is the docker compose file:
```YAML
---
services:
  kagent:
    hostname: kagent03
    image: kentik/kagent:latest
    restart: unless-stopped
    pull_policy: always
    cap_add:
      - NET_RAW
    environment:
      - K_COMPANY_ID=&lt;REDACTED&gt;
      - K_API_ROOT=grpc.api.kentik.eu:443
      #- K_LOG_LEVEL=debug
    volumes:
      - /opt/dev/kentik/kagent-data:/opt/kentik
      - /opt/dev/kentik/override-data:/opt/kentik/components/ranger/local/
      
```

---
## Junos Firewall Filters


In Junos the flowspec rules create relevant ad-hoc firewall filters and policers that are applied to the linecards and can be examined via the show firewall detail command. Here is what we get with nothing configured:
```Bash
netops@ATH-POP1-VMX1&gt; show configuration firewall

netops@ATH-POP1-VMX1&gt; show firewall detail

Filter: __default_bpdu_filter__
```
And here is what we get if we configure a filter to count SSH packets destined to the management IP of the device and two manual mitigations from the portal, one to block traffic and one to rate limit:
```Bash
netops@ATH-POP1-VMX1&gt; show firewall detail

Filter: __default_bpdu_filter__

Filter: TEST-FIREWALL
Counters:
Name                                                Bytes              Packets
SSH-PACKETS                                         74932                 1153

Filter: __flowspec_default_inet__
Counters:
Name                                                Bytes              Packets
10.11.10.10,*,icmp-type=8                           41496                   30
10.11.10.10,*,proto=6,dstport=5201                 172233                  184
Policers:
Name                                                Bytes              Packets
40K_10.11.10.10,*,proto=6,dstport=5201               402000                  268
```
So any flowpsec rule received is reported under the `__flowspec_default_inet__` filter. The one that blocks ICMP traffic is a counter and the one that limits IPERF is both a counter and a policer.

### SNMP
It seems that Juniper has a dedicated MIB for reporting those firewall metrics, the _JUNOS-FIREWALL-MIB_ and after downloading all juniper MIBs in my `~/.snmp/mibs` directory and grepping for Firewall I got this:
```Bash
jnxFirewallsTable   OBJECT-TYPE
        SYNTAX      SEQUENCE OF JnxFirewallsEntry
        MAX-ACCESS  not-accessible
        STATUS      deprecated
        DESCRIPTION
                &#34;A list of firewalls entries.
                NOTE:  This table is deprecated and exists for backward
                compatibility.  The user is encouraged to use
                jnxFirewallCounterTable.  This table does not handle:
                1) counter and filter names greater than 24 characters
                2) counters with same names but different types (the first
                  duplicate is returned only)&#34;


        ::= { jnxFirewalls 1 }

```
So the interesting OID to be polled is the `jnxFirewallCounterTable` at **1.3.6.1.4.1.2636.3.5.2**. Let’s use snmptable to see what we get:
```Bash
$ snmptable -v2c -c kentik -m all 10.11.255.1 jnxFirewallCounterTable
SNMP table: JUNIPER-FIREWALL-MIB::jnxFirewallCounterTable

 jnxFWCounterPacketCount jnxFWCounterByteCount jnxFWCounterDisplayFilterName                jnxFWCounterDisplayName jnxFWCounterDisplayType
                    1118                 72508                 TEST-FIREWALL                            SSH-PACKETS                 counter
                       0                     0       __default_arp_policer__                __default_arp_policer__                 policer
                      30                 41496     __flowspec_default_inet__              10.11.10.10,*,icmp-type=8                 counter
                     184                172233     __flowspec_default_inet__     10.11.10.10,*,proto=6,dstport=5201                 counter
                     268                402000     __flowspec_default_inet__ 40K_10.11.10.10,*,proto=6,dstport=5201                 policer
```

#### Local Configuration
From this point onward we can define our custom metrics in the relevant _overrides_ sub-directories


&lt;p style=&#34;background-color:skyblue;text-align:center&#34;&gt;&lt;b&gt;Sources file&lt;/b&gt;&lt;/p&gt;

We are going to poll the table every 1 minute.
```YAML
---
version: 1
metadata:
  name: junos-fw-snmp
  kind: sources
sources:
  junos-fw-snmp: !snmp
    table: 1.3.6.1.4.1.2636.3.5.2
    interval: 60s

```
&lt;p style=&#34;background-color:skyblue;text-align:center&#34;&gt;&lt;b&gt;Profiles file&lt;/b&gt;&lt;/p&gt;

We will bind the source to the vMX sysObjectId
```YAML
---
version: 1
metadata:
  name: junos-fw-snmp
  kind: profile
profile:
  match:
    sysobjectid:
      - 1.3.6.1.4.1.2636.1.1.1.2.108
  reports:
    - junos-fw-snmp
  include:
    - device_name_ip
  sources:
    - junos-fw-snmp

```

&lt;p style=&#34;background-color:skyblue;text-align:center&#34;&gt;&lt;b&gt;Reports file&lt;/b&gt;&lt;/p&gt;

We are going to report those under the `/junos/firewall/snmp` schema path in the Portal and we define the mapping on the table fields identifying the metrics:
```YAML
---
version: 1
metadata:
  name: junos-fw-snmp
  kind: reports
reports:
  /junos/firewall/snmp:
    combine:
      table0: !snmp
        table: 1.3.6.1.4.1.2636.3.5.2
        index: $index0
    fields:
      packets: !snmp
        table: 1.3.6.1.4.1.2636.3.5.2
        value: 1.3.6.1.4.1.2636.3.5.2.1.4
        metric: true
      bytes: !snmp
        table: 1.3.6.1.4.1.2636.3.5.2
        value: 1.3.6.1.4.1.2636.3.5.2.1.5
        metric: true
      filter_name: !snmp
        table: 1.3.6.1.4.1.2636.3.5.2
        value: 1.3.6.1.4.1.2636.3.5.2.1.6
        metric: false
      counter_name: !snmp
        table: 1.3.6.1.4.1.2636.3.5.2
        value: 1.3.6.1.4.1.2636.3.5.2.1.7
        metric: false
      counter_type: !snmp
        table: 1.3.6.1.4.1.2636.3.5.2
        value: 1.3.6.1.4.1.2636.3.5.2.1.8
        metric: false
        tweak: !enum
          1: other
          2: counter
          3: policer
    interval: 60s
```

Here is how our _overrides_ directory structure looks like:
```Bash
override-data/
└── config
    ├── profiles
    │   ├── junos-fw-snmp.yml
    ├── reports
    │   ├── junos-fw-snmp.yml
    └── sources
        └── junos-fw-snmp.yml

```
I&#39;ve used the same file name for these but it could be anything. Resources are referenced via the metadata name key and not by the filename.

#### Kagent Bring Up
Next step is to bring up the container and see what we get, but it seems there is an error:
```JSON
{&#34;level&#34;:&#34;error&#34;,&#34;error&#34;:&#34;OID 1.3.6.1.4.1.2636.3.5.2 in table source jnxFirewallCounterTable 
 loaded from config/sources/snmp/juniper.yml also appears in table source junos-fw-snmp 
 loaded from sources/junos-fw-snmp.yml&#34;,&#34;time&#34;:&#34;2024-05-03T16:51:41Z&#34;,&#34;message&#34;:&#34;invalid config&#34;}
```
This means that kagent is already configured to poll this OID from the file mentioned.
{{&lt; admonition note &#34;Kagent Default Config&#34; true&gt;}}
Kagent is pulling its _default configuration_ each time is brought up and this is in the `/opt/kentik/components/ranger/current/LATEST.zip` file
{{&lt; /admonition &gt;}}
So after unziping the file and looking into the file mentioned we see that the definition is there and the table is polled every five minutes:
```Bash
$ cat config/sources/snmp/juniper.yml | grep FirewallCounter -A3
  jnxFirewallCounterTable: !snmp
    table: 1.3.6.1.4.1.2636.3.5.2
    interval: 5m
```
In this case, since we can have reports and profiles referring to existing sources in the `LATEST.zip` file we are going to remove the sources definition file and remove the reference in the profiles. Furthermore, we are going to adjust the interval in the profile definition since there is no reason to report more frequently than we gather the data at this point.

Upon restarting kagent, the _overrides_ directory is picked up with no errors:
```JSON
{&#34;level&#34;:&#34;info&#34;,&#34;path&#34;:&#34;../local/config&#34;,&#34;time&#34;:&#34;2024-05-03T17:12:58Z&#34;,
 &#34;message&#34;:&#34;optional/override config directory exists, using&#34;}
```

#### Kentik Portal
In the portal, the metrics are available under the configured path:

{{&lt; image src=&#34;img_001.png&#34; caption=&#34;SCHEMA path&#34; width=&#34;400&#34;&gt;}}


The table is populating:
{{&lt; image src=&#34;img_002.png&#34; caption=&#34;Junos Metrics Table&#34; &gt;}}




After a while the chart started graphing as well
{{&lt; image src=&#34;img_003.png&#34; caption=&#34;Junos Metrics Chart&#34; &gt;}}


### GRPC

Let’s try now to get the same via streaming telemetry and GRPC. According to [this](https://www.juniper.net/documentation/us/en/software/junos/interfaces-telemetry/topics/concept/junos-telemetry-interface-grpc-sensors.html) we can get those metrics under the `/junos/system/linecard/firewall` path.

Using gnmic (I could only get data via subscriptions and not get rpc calls):
```JSON
$ gnmic -a 10.11.255.1:32767 -u &lt;username&gt;-p &lt;password&gt; --skip-verify sub --mode once --path /junos/system/linecard/firewall
{
  &#34;source&#34;: &#34;10.11.255.1:32767&#34;,
  &#34;subscription-name&#34;: &#34;default-1714758367&#34;,
  &#34;timestamp&#34;: 1714758371632000000,
  &#34;time&#34;: &#34;2024-05-03T20:46:11.632&#43;03:00&#34;,
  &#34;prefix&#34;: &#34;junos/firewall[name=__default_bpdu_filter__]/state&#34;,
  &#34;updates&#34;: [
    {
      &#34;Path&#34;: &#34;timestamp&#34;,
      &#34;values&#34;: {
        &#34;timestamp&#34;: 1714746658
      }
    },
    {
      &#34;Path&#34;: &#34;memory-usage[name=HEAP]/allocated&#34;,
      &#34;values&#34;: {
        &#34;memory-usage/allocated&#34;: 2596
      }
    }
  ]
}
{
  &#34;source&#34;: &#34;10.11.255.1:32767&#34;,
  &#34;subscription-name&#34;: &#34;default-1714758367&#34;,
  &#34;timestamp&#34;: 1714758371632000000,
  &#34;time&#34;: &#34;2024-05-03T20:46:11.632&#43;03:00&#34;,
  &#34;prefix&#34;: &#34;junos/firewall[name=TEST-FIREWALL]/state&#34;,
  &#34;updates&#34;: [
    {
      &#34;Path&#34;: &#34;timestamp&#34;,
      &#34;values&#34;: {
        &#34;timestamp&#34;: 1714746658
      }
    },
    {
      &#34;Path&#34;: &#34;memory-usage[name=HEAP]/allocated&#34;,
      &#34;values&#34;: {
        &#34;memory-usage/allocated&#34;: 4004
      }
    },
    {
      &#34;Path&#34;: &#34;counter[name=SSH-PACKETS]/packets&#34;,
      &#34;values&#34;: {
        &#34;counter/packets&#34;: 1162
      }
    },
    {
      &#34;Path&#34;: &#34;counter[name=SSH-PACKETS]/bytes&#34;,
      &#34;values&#34;: {
        &#34;counter/bytes&#34;: 75400
      }
    }
  ]
}
{
  &#34;source&#34;: &#34;10.11.255.1:32767&#34;,
  &#34;subscription-name&#34;: &#34;default-1714758367&#34;,
  &#34;timestamp&#34;: 1714758371632000000,
  &#34;time&#34;: &#34;2024-05-03T20:46:11.632&#43;03:00&#34;,
  &#34;prefix&#34;: &#34;junos/firewall[name=__default_arp_policer__]/state&#34;,
  &#34;updates&#34;: [
    {
      &#34;Path&#34;: &#34;timestamp&#34;,
      &#34;values&#34;: {
        &#34;timestamp&#34;: 1714403887
      }
    },
    {
      &#34;Path&#34;: &#34;memory-usage[name=HEAP]/allocated&#34;,
      &#34;values&#34;: {
        &#34;memory-usage/allocated&#34;: 1652
      }
    },
    {
      &#34;Path&#34;: &#34;policer[name=__default_arp_policer__]/out-of-spec-packets&#34;,
      &#34;values&#34;: {
        &#34;policer/out-of-spec-packets&#34;: 0
      }
    },
    {
      &#34;Path&#34;: &#34;policer[name=__default_arp_policer__]/out-of-spec-bytes&#34;,
      &#34;values&#34;: {
        &#34;policer/out-of-spec-bytes&#34;: 0
      }
    },
    {
      &#34;Path&#34;: &#34;policer[name=__default_arp_policer__]/offered-packets&#34;,
      &#34;values&#34;: {
        &#34;policer/offered-packets&#34;: 0
      }
    },
    {
      &#34;Path&#34;: &#34;policer[name=__default_arp_policer__]/offered-bytes&#34;,
      &#34;values&#34;: {
        &#34;policer/offered-bytes&#34;: 0
      }
    },
    {
      &#34;Path&#34;: &#34;policer[name=__default_arp_policer__]/transmitted-packets&#34;,
      &#34;values&#34;: {
        &#34;policer/transmitted-packets&#34;: 0
      }
    },
    {
      &#34;Path&#34;: &#34;policer[name=__default_arp_policer__]/transmitted-bytes&#34;,
      &#34;values&#34;: {
        &#34;policer/transmitted-bytes&#34;: 0
      }
    }
  ]
}
{
  &#34;source&#34;: &#34;10.11.255.1:32767&#34;,
  &#34;subscription-name&#34;: &#34;default-1714758367&#34;,
  &#34;timestamp&#34;: 1714758371632000000,
  &#34;time&#34;: &#34;2024-05-03T20:46:11.632&#43;03:00&#34;,
  &#34;prefix&#34;: &#34;junos/firewall[name=__flowspec_default_inet__]/state&#34;,
  &#34;updates&#34;: [
    {
      &#34;Path&#34;: &#34;timestamp&#34;,
      &#34;values&#34;: {
        &#34;timestamp&#34;: 1714753321
      }
    },
    {
      &#34;Path&#34;: &#34;memory-usage[name=HEAP]/allocated&#34;,
      &#34;values&#34;: {
        &#34;memory-usage/allocated&#34;: 7172
      }
    },
    {
      &#34;Path&#34;: &#34;counter[name=10.11.10.10,*,icmp-type=8]/packets&#34;,
      &#34;values&#34;: {
        &#34;counter/packets&#34;: 1315
      }
    },
    {
      &#34;Path&#34;: &#34;counter[name=10.11.10.10,*,icmp-type=8]/bytes&#34;,
      &#34;values&#34;: {
        &#34;counter/bytes&#34;: 1876476
      }
    },
    {
      &#34;Path&#34;: &#34;counter[name=10.11.10.10,*,proto=6,dstport=5201]/packets&#34;,
      &#34;values&#34;: {
        &#34;counter/packets&#34;: 3311
      }
    },
    {
      &#34;Path&#34;: &#34;counter[name=10.11.10.10,*,proto=6,dstport=5201]/bytes&#34;,
      &#34;values&#34;: {
        &#34;counter/bytes&#34;: 4738920
      }
    },
    {
      &#34;Path&#34;: &#34;policer[name=40K_10.11.10.10,*,proto=6,dstport=5201]/out-of-spec-packets&#34;,
      &#34;values&#34;: {
        &#34;policer/out-of-spec-packets&#34;: 6891
      }
    },
    {
      &#34;Path&#34;: &#34;policer[name=40K_10.11.10.10,*,proto=6,dstport=5201]/out-of-spec-bytes&#34;,
      &#34;values&#34;: {
        &#34;policer/out-of-spec-bytes&#34;: 10336500
      }
    },
    {
      &#34;Path&#34;: &#34;policer[name=40K_10.11.10.10,*,proto=6,dstport=5201]/offered-packets&#34;,
      &#34;values&#34;: {
        &#34;policer/offered-packets&#34;: 0
      }
    },
    {
      &#34;Path&#34;: &#34;policer[name=40K_10.11.10.10,*,proto=6,dstport=5201]/offered-bytes&#34;,
      &#34;values&#34;: {
        &#34;policer/offered-bytes&#34;: 0
      }
    },
    {
      &#34;Path&#34;: &#34;policer[name=40K_10.11.10.10,*,proto=6,dstport=5201]/transmitted-packets&#34;,
      &#34;values&#34;: {
        &#34;policer/transmitted-packets&#34;: 0
      }
    },
    {
      &#34;Path&#34;: &#34;policer[name=40K_10.11.10.10,*,proto=6,dstport=5201]/transmitted-bytes&#34;,
      &#34;values&#34;: {
        &#34;policer/transmitted-bytes&#34;: 0
      }
    }
  ]
}
{
  &#34;source&#34;: &#34;10.11.255.1:32767&#34;,
  &#34;subscription-name&#34;: &#34;default-1714758367&#34;,
  &#34;timestamp&#34;: 1714758371633000000,
  &#34;time&#34;: &#34;2024-05-03T20:46:11.633&#43;03:00&#34;,
  &#34;prefix&#34;: &#34;junos/firewall[name=__default_bpdu_filter__]/state&#34;,
  &#34;updates&#34;: [
    {
      &#34;Path&#34;: &#34;timestamp&#34;,
      &#34;values&#34;: {
        &#34;timestamp&#34;: 1714746658
      }
    },
    {
      &#34;Path&#34;: &#34;memory-usage[name=HEAP]/allocated&#34;,
      &#34;values&#34;: {
        &#34;memory-usage/allocated&#34;: 2596
      }
    }
  ]
}
{
  &#34;source&#34;: &#34;10.11.255.1:32767&#34;,
  &#34;subscription-name&#34;: &#34;default-1714758367&#34;,
  &#34;timestamp&#34;: 1714758371633000000,
  &#34;time&#34;: &#34;2024-05-03T20:46:11.633&#43;03:00&#34;,
  &#34;prefix&#34;: &#34;junos/firewall[name=TEST-FIREWALL]/state&#34;,
  &#34;updates&#34;: [
    {
      &#34;Path&#34;: &#34;timestamp&#34;,
      &#34;values&#34;: {
        &#34;timestamp&#34;: 1714746658
      }
    },
    {
      &#34;Path&#34;: &#34;memory-usage[name=HEAP]/allocated&#34;,
      &#34;values&#34;: {
        &#34;memory-usage/allocated&#34;: 4004
      }
    },
    {
      &#34;Path&#34;: &#34;counter[name=SSH-PACKETS]/packets&#34;,
      &#34;values&#34;: {
        &#34;counter/packets&#34;: 1162
      }
    },
    {
      &#34;Path&#34;: &#34;counter[name=SSH-PACKETS]/bytes&#34;,
      &#34;values&#34;: {
        &#34;counter/bytes&#34;: 75400
      }
    }
  ]
}
{
  &#34;source&#34;: &#34;10.11.255.1:32767&#34;,
  &#34;subscription-name&#34;: &#34;default-1714758367&#34;,
  &#34;timestamp&#34;: 1714758371633000000,
  &#34;time&#34;: &#34;2024-05-03T20:46:11.633&#43;03:00&#34;,
  &#34;prefix&#34;: &#34;junos/firewall[name=__default_arp_policer__]/state&#34;,
  &#34;updates&#34;: [
    {
      &#34;Path&#34;: &#34;timestamp&#34;,
      &#34;values&#34;: {
        &#34;timestamp&#34;: 1714403887
      }
    },
    {
      &#34;Path&#34;: &#34;memory-usage[name=HEAP]/allocated&#34;,
      &#34;values&#34;: {
        &#34;memory-usage/allocated&#34;: 1652
      }
    }
  ]
}
{
  &#34;source&#34;: &#34;10.11.255.1:32767&#34;,
  &#34;subscription-name&#34;: &#34;default-1714758367&#34;,
  &#34;timestamp&#34;: 1714758371633000000,
  &#34;time&#34;: &#34;2024-05-03T20:46:11.633&#43;03:00&#34;,
  &#34;prefix&#34;: &#34;junos/firewall[name=__flowspec_default_inet__]/state&#34;,
  &#34;updates&#34;: [
    {
      &#34;Path&#34;: &#34;timestamp&#34;,
      &#34;values&#34;: {
        &#34;timestamp&#34;: 1714753321
      }
    },
    {
      &#34;Path&#34;: &#34;memory-usage[name=HEAP]/allocated&#34;,
      &#34;values&#34;: {
        &#34;memory-usage/allocated&#34;: 7172
      }
    },
    {
      &#34;Path&#34;: &#34;counter[name=10.11.10.10,*,icmp-type=8]/packets&#34;,
      &#34;values&#34;: {
        &#34;counter/packets&#34;: 1315
      }
    },
    {
      &#34;Path&#34;: &#34;counter[name=10.11.10.10,*,icmp-type=8]/bytes&#34;,
      &#34;values&#34;: {
        &#34;counter/bytes&#34;: 1876476
      }
    },
    {
      &#34;Path&#34;: &#34;counter[name=10.11.10.10,*,proto=6,dstport=5201]/packets&#34;,
      &#34;values&#34;: {
        &#34;counter/packets&#34;: 3311
      }
    },
    {
      &#34;Path&#34;: &#34;counter[name=10.11.10.10,*,proto=6,dstport=5201]/bytes&#34;,
      &#34;values&#34;: {
        &#34;counter/bytes&#34;: 4738920
      }
    },
    {
      &#34;Path&#34;: &#34;policer[name=40K_10.11.10.10,*,proto=6,dstport=5201]/out-of-spec-packets&#34;,
      &#34;values&#34;: {
        &#34;policer/out-of-spec-packets&#34;: 6891
      }
    },
    {
      &#34;Path&#34;: &#34;policer[name=40K_10.11.10.10,*,proto=6,dstport=5201]/out-of-spec-bytes&#34;,
      &#34;values&#34;: {
        &#34;policer/out-of-spec-bytes&#34;: 10336500
      }
    }
  ]
}
```

Let&#39;s briefly look at the paths returned to better understand what we are getting via this subscription:
```YAML
$ gnmic -a 10.11.255.1:32767 -u &lt;username&gt; -p &lt;password&gt; --skip-verify sub --mode once --path /junos/system/linecard/firewall | grep -e prefix -e Path
  &#34;prefix&#34;: &#34;junos/firewall[name=__default_bpdu_filter__]/state&#34;,
      &#34;Path&#34;: &#34;timestamp&#34;,
      &#34;Path&#34;: &#34;memory-usage[name=HEAP]/allocated&#34;,
  &#34;prefix&#34;: &#34;junos/firewall[name=TEST-FIREWALL]/state&#34;,
      &#34;Path&#34;: &#34;timestamp&#34;,
      &#34;Path&#34;: &#34;memory-usage[name=HEAP]/allocated&#34;,
      &#34;Path&#34;: &#34;counter[name=SSH-PACKETS]/packets&#34;,
      &#34;Path&#34;: &#34;counter[name=SSH-PACKETS]/bytes&#34;,
  &#34;prefix&#34;: &#34;junos/firewall[name=__default_arp_policer__]/state&#34;,
      &#34;Path&#34;: &#34;timestamp&#34;,
      &#34;Path&#34;: &#34;memory-usage[name=HEAP]/allocated&#34;,
      &#34;Path&#34;: &#34;policer[name=__default_arp_policer__]/out-of-spec-packets&#34;,
      &#34;Path&#34;: &#34;policer[name=__default_arp_policer__]/out-of-spec-bytes&#34;,
      &#34;Path&#34;: &#34;policer[name=__default_arp_policer__]/offered-packets&#34;,
      &#34;Path&#34;: &#34;policer[name=__default_arp_policer__]/offered-bytes&#34;,
      &#34;Path&#34;: &#34;policer[name=__default_arp_policer__]/transmitted-packets&#34;,
      &#34;Path&#34;: &#34;policer[name=__default_arp_policer__]/transmitted-bytes&#34;,
  &#34;prefix&#34;: &#34;junos/firewall[name=__flowspec_default_inet__]/state&#34;,
      &#34;Path&#34;: &#34;timestamp&#34;,
      &#34;Path&#34;: &#34;memory-usage[name=HEAP]/allocated&#34;,
      &#34;Path&#34;: &#34;counter[name=10.11.10.10,*,icmp-type=8]/packets&#34;,
      &#34;Path&#34;: &#34;counter[name=10.11.10.10,*,icmp-type=8]/bytes&#34;,
      &#34;Path&#34;: &#34;counter[name=10.11.10.10,*,proto=6,dstport=5201]/packets&#34;,
      &#34;Path&#34;: &#34;counter[name=10.11.10.10,*,proto=6,dstport=5201]/bytes&#34;,
      &#34;Path&#34;: &#34;policer[name=40K_10.11.10.10,*,proto=6,dstport=5201]/out-of-spec-packets&#34;,
      &#34;Path&#34;: &#34;policer[name=40K_10.11.10.10,*,proto=6,dstport=5201]/out-of-spec-bytes&#34;,
      &#34;Path&#34;: &#34;policer[name=40K_10.11.10.10,*,proto=6,dstport=5201]/offered-packets&#34;,
      &#34;Path&#34;: &#34;policer[name=40K_10.11.10.10,*,proto=6,dstport=5201]/offered-bytes&#34;,
      &#34;Path&#34;: &#34;policer[name=40K_10.11.10.10,*,proto=6,dstport=5201]/transmitted-packets&#34;,
      &#34;Path&#34;: &#34;policer[name=40K_10.11.10.10,*,proto=6,dstport=5201]/transmitted-bytes&#34;,
  &#34;prefix&#34;: &#34;junos/firewall[name=__default_bpdu_filter__]/state&#34;,
      &#34;Path&#34;: &#34;timestamp&#34;,
      &#34;Path&#34;: &#34;memory-usage[name=HEAP]/allocated&#34;,
  &#34;prefix&#34;: &#34;junos/firewall[name=TEST-FIREWALL]/state&#34;,
      &#34;Path&#34;: &#34;timestamp&#34;,
      &#34;Path&#34;: &#34;memory-usage[name=HEAP]/allocated&#34;,
      &#34;Path&#34;: &#34;counter[name=SSH-PACKETS]/packets&#34;,
      &#34;Path&#34;: &#34;counter[name=SSH-PACKETS]/bytes&#34;,
  &#34;prefix&#34;: &#34;junos/firewall[name=__default_arp_policer__]/state&#34;,
      &#34;Path&#34;: &#34;timestamp&#34;,
      &#34;Path&#34;: &#34;memory-usage[name=HEAP]/allocated&#34;,
  &#34;prefix&#34;: &#34;junos/firewall[name=__flowspec_default_inet__]/state&#34;,
      &#34;Path&#34;: &#34;timestamp&#34;,
      &#34;Path&#34;: &#34;memory-usage[name=HEAP]/allocated&#34;,
      &#34;Path&#34;: &#34;counter[name=10.11.10.10,*,icmp-type=8]/packets&#34;,
      &#34;Path&#34;: &#34;counter[name=10.11.10.10,*,icmp-type=8]/bytes&#34;,
      &#34;Path&#34;: &#34;counter[name=10.11.10.10,*,proto=6,dstport=5201]/packets&#34;,
      &#34;Path&#34;: &#34;counter[name=10.11.10.10,*,proto=6,dstport=5201]/bytes&#34;,
      &#34;Path&#34;: &#34;policer[name=40K_10.11.10.10,*,proto=6,dstport=5201]/out-of-spec-packets&#34;,
      &#34;Path&#34;: &#34;policer[name=40K_10.11.10.10,*,proto=6,dstport=5201]/out-of-spec-bytes&#34;,
```

It looks like we are getting the allocated memory per filter and the relevant metrics according to if the filter is a counter or policer. Let&#39;s create the relevant local overrides files. In the reports file we need extra processing on the data returned from the subscription before it is stored in the database and this is done via the use of starlark scripts.

#### Local Configuration (take 1)

&lt;p style=&#34;background-color:skyblue;text-align:center&#34;&gt;&lt;b&gt;Sources file&lt;/b&gt;&lt;/p&gt;

```YAML
version: 1
metadata:
  name: junos-fw-grpc
  kind: sources
sources:
  junos-fw-grpc: !gnmi
    path: /junos/system/linecard/firewall/
    mode: SAMPLE
    extra:
      sample_interval: 30s

```
&lt;p style=&#34;background-color:skyblue;text-align:center&#34;&gt;&lt;b&gt;Profiles file&lt;/b&gt;&lt;/p&gt;


```YAML
version: 1
metadata:
  name: junos-fw-grpc
  kind: profile
profile:
  match:
    sysobjectid:
      - 1.3.6.1.4.1.2636.1.1.1.2.108
    features:
      - gnmi
  reports:
    - junos-fw-grpc
  include:
    - device_name_ip
  sources:
    - junos-fw-grpc
```

&lt;p style=&#34;background-color:skyblue;text-align:center&#34;&gt;&lt;b&gt;Reports file&lt;/b&gt;&lt;/p&gt;

```YAML
version: 1
metadata:
  name: junos-fw-grpc
  kind: reports
reports:
  /junos/firewall/grpc:
    script: !external
      type: starlark
      file: junos-fw-grpc.star
    interval: 30s
```

The starlark script acts as a pre-processor to the data before forming it to influx line protocol and ingesting it in the database. So we have options to manipulate the data according to the use case. 

From the rpc we see that all information is returned under the `/junos/firewall/` path so lets see what we get from this. We are going to use the log method to output the dictionary we receive from gnmi in the container logs using a basic starlark script:

&lt;p style=&#34;background-color:skyblue;text-align:center&#34;&gt;&lt;b&gt;Basic Starlark Script&lt;/b&gt;&lt;/p&gt;

```python
load(&#34;ranger&#34;, &#34;source&#34;)
load(&#34;ranger&#34;, &#34;metric&#34;)
load(&#34;ranger&#34;, &#34;device&#34;)
load(&#34;ranger&#34;, &#34;log&#34;)

def execute(report):
    log(&#34;###### STARTING STRALARK #######&#34;)
    data = source.select(&#34;junos/firewall&#34;)
    log(data)
    log(&#34;###### STRALARK FINISHED #######&#34;)
```
Here is how our overrides directory look like:
```Bash
override-data/
└── config
    ├── profiles
    │   ├── junos-fw-grpc.yml
    │   └── junos-fw-snmp.yml
    ├── reports
    │   ├── junos-fw-grpc.star
    │   ├── junos-fw-grpc.yml
    │   └── junos-fw-snmp.yml
    └── sources
        └── junos-fw-grpc.yml
```

And here is what is returned from starlark when we dump it as a dictionary:
```JSON
[
  {
    &#34;state&#34;: {
      &#34;timestamp&#34;: 1714746658,
      &#34;memory-usage&#34;: [
        {
          &#34;allocated&#34;: 2596,
          &#34;name&#34;: &#34;HEAP&#34;
        }
      ]
    },
    &#34;name&#34;: &#34;__default_bpdu_filter__&#34;
  },
  {
    &#34;state&#34;: {
      &#34;timestamp&#34;: 1714746658,
      &#34;memory-usage&#34;: [
        {
          &#34;allocated&#34;: 4004,
          &#34;name&#34;: &#34;HEAP&#34;
        }
      ],
      &#34;counter&#34;: [
        {
          &#34;packets&#34;: 1341,
          &#34;bytes&#34;: 88064,
          &#34;name&#34;: &#34;SSH-PACKETS&#34;
        }
      ]
    },
    &#34;name&#34;: &#34;TEST-FIREWALL&#34;
  },
  {
    &#34;state&#34;: {
      &#34;policer&#34;: [
        {
          &#34;out-of-spec-packets&#34;: 0,
          &#34;out-of-spec-bytes&#34;: 0,
          &#34;offered-packets&#34;: 0,
          &#34;offered-bytes&#34;: 0,
          &#34;transmitted-packets&#34;: 0,
          &#34;transmitted-bytes&#34;: 0,
          &#34;name&#34;: &#34;__default_arp_policer__&#34;
        }
      ],
      &#34;timestamp&#34;: 1714403887,
      &#34;memory-usage&#34;: [
        {
          &#34;allocated&#34;: 1652,
          &#34;name&#34;: &#34;HEAP&#34;
        }
      ]
    },
    &#34;name&#34;: &#34;__default_arp_policer__&#34;
  },
  {
    &#34;state&#34;: {
      &#34;timestamp&#34;: 1714753321,
      &#34;memory-usage&#34;: [
        {
          &#34;allocated&#34;: 7172,
          &#34;name&#34;: &#34;HEAP&#34;
        }
      ],
      &#34;counter&#34;: [
        {
          &#34;packets&#34;: 36574,
          &#34;bytes&#34;: 52226328,
          &#34;name&#34;: &#34;10.11.10.10,*,icmp-type=8&#34;
        },
        {
          &#34;packets&#34;: 6336,
          &#34;bytes&#34;: 9216704,
          &#34;name&#34;: &#34;10.11.10.10,*,proto=6,dstport=5201&#34;
        }
      ],
      &#34;policer&#34;: [
        {
          &#34;out-of-spec-packets&#34;: 13378,
          &#34;out-of-spec-bytes&#34;: 20067000,
          &#34;offered-packets&#34;: 0,
          &#34;offered-bytes&#34;: 0,
          &#34;transmitted-packets&#34;: 0,
          &#34;transmitted-bytes&#34;: 0,
          &#34;name&#34;: &#34;40K_10.11.10.10,*,proto=6,dstport=5201&#34;
        }
      ]
    },
    &#34;name&#34;: &#34;__flowspec_default_inet__&#34;
  }
]
```

So we got a list of dictionaries. One dictionary per firewall filter containing the allocated memory and the counter or policer names and metrics. Now since the counter metrics are different from the policer one&#39;s, it seems wise to report them in different paths on the portal schema. For example:

- `/junos/firewall/filter/memory/` → will hold the allocated memory for each filter
- `/junos/firewall/filter/counters/` → will hold the counter metrics
- `/junos/firewall/filter/policers/` → will hold the policer metrics

#### Local Configuration (take 2)

&lt;p style=&#34;background-color:skyblue;text-align:center&#34;&gt;&lt;b&gt;Reports - different paths&lt;/b&gt;&lt;/p&gt;
In order to achieve this we are going to adjust our reports file to specify those three different configs, paths and scripts.

```YAML
version: 1
metadata:
  name: junos-fw-grpc
  kind: reports
reports:
  /junos/firewall/filter/memory:
    script: !external
      type: starlark
      file: junos-fw-grpc-memory.star
    interval: 30s
  /junos/firewall/filter/counters:
    script: !external
      type: starlark
      file: junos-fw-grpc-counters.star
    interval: 30s
  /junos/firewall/filter/policers:
    script: !external
      type: starlark
      file: junos-fw-grpc-policers.star
    interval: 30s
```


&lt;p style=&#34;background-color:skyblue;text-align:center&#34;&gt;&lt;b&gt;Starlark - Memory&lt;/b&gt;&lt;/p&gt;

```python
load(&#34;ranger&#34;, &#34;source&#34;)
load(&#34;ranger&#34;, &#34;metric&#34;)
load(&#34;ranger&#34;, &#34;device&#34;)
load(&#34;ranger&#34;, &#34;log&#34;)

def execute(report):
    log(&#34;###### STLRK - MEMORY START #######&#34;)
    data = source.select(&#34;junos/firewall&#34;)

    if data:
        # iterate over non empty dicts in the list
        for name, memory in  [
            (_.get(&#39;name&#39;),
             _[&#39;state&#39;][&#39;memory-usage&#39;][0][&#39;allocated&#39;]
             ) for _ in data if _]:
            record = report.append()
            record.append(&#34;filter_name&#34;, name)
            record.append(&#34;allocated_memory&#34;, memory, metric=True)
            record.append(&#34;device_name&#34;, device().config.name)
            record.append(&#34;device_ip&#34;, device().config.host)
        log(&#34;###### STLRK - MEMORY END #######&#34;)
    else:
        log(&#34;###### STLRK - MEMORY *** EMPTY **** #######&#34;)
```

&lt;p style=&#34;background-color:skyblue;text-align:center&#34;&gt;&lt;b&gt;Starlark - Counters&lt;/b&gt;&lt;/p&gt;

```python
load(&#34;ranger&#34;, &#34;source&#34;)
load(&#34;ranger&#34;, &#34;metric&#34;)
load(&#34;ranger&#34;, &#34;device&#34;)
load(&#34;ranger&#34;, &#34;log&#34;)

def execute(report):
    log(&#34;###### STLRK - COUNTERS START #######&#34;)
    data = source.select(&#34;junos/firewall&#34;)

    if data:
        # iterate over non empty dicts that have counter key
        for fname, state in  [
            (_.get(&#39;name&#39;),
             _.get(&#39;state&#39;)
             ) for _ in data if _ and _[&#39;state&#39;].get(&#39;counter&#39;)] :

            for cname, packets, bytes in [
                (_.get(&#39;name&#39;) ,
                 _.get(&#39;packets&#39;),
                 _.get(&#39;bytes&#39;)) for _ in state[&#39;counter&#39;] ]:

                record = report.append()
                record.append(&#34;filter_name&#34;, fname)
                record.append(&#34;counter_name&#34;, cname)
                record.append(&#34;packets&#34;, packets, metric=True)
                record.append(&#34;bytes&#34;, bytes, metric=True)
                record.append(&#34;device_name&#34;, device().config.name)
                record.append(&#34;device_ip&#34;, device().config.host)

        log(&#34;###### STLRK - COUNTERS END #######&#34;)
    else:
        log(&#34;###### STLRK - COUNTERS *** EMPTY **** #######&#34;)
```

&lt;p style=&#34;background-color:skyblue;text-align:center&#34;&gt;&lt;b&gt;Starlark - Policers&lt;/b&gt;&lt;/p&gt;

```python
load(&#34;ranger&#34;, &#34;source&#34;)
load(&#34;ranger&#34;, &#34;metric&#34;)
load(&#34;ranger&#34;, &#34;device&#34;)
load(&#34;ranger&#34;, &#34;log&#34;)

metrics = [
    &#39;offered-bytes&#39;,
    &#39;offered-packets&#39;,
    &#39;out-of-spec-bytes&#39;,
    &#39;out-of-spec-packets&#39;,
    &#39;transmitted-bytes&#39;,
    &#39;transmitted-packets&#39;
]

def execute(report):
    log(&#34;###### STLRK - POLICER START #######&#34;)
    data = source.select(&#34;junos/firewall&#34;)

    if data:
        # iterate over non empty dicts that have policer key
        for fname, state in  [
            (_.get(&#39;name&#39;),
             _.get(&#39;state&#39;)
             ) for _ in data if _ and _[&#39;state&#39;].get(&#39;policer&#39;)]:

            for policer in state[&#39;policer&#39;]:
                record = report.append()
                record.append(&#34;filter_name&#34;, fname)
                record.append(&#34;policer_name&#34;, policer.pop(&#39;name&#39;))
                # Get metrics defined statically above
                for key in metrics:
                    record.append(key, policer.get(key) , metric=True)
                record.append(&#34;device_name&#34;, device().config.name)
                record.append(&#34;device_ip&#34;, device().config.host)

        log(&#34;###### STLRK - POLICER END #######&#34;)
    else:
        log(&#34;###### STLRK - POLICER *** EMPTY **** #######&#34;)
```

And this is our _overrides_ structure now:
```Bash
override-data/
└── config
    ├── profiles
    │   ├── junos-fw-grpc.yml
    │   └── junos-fw-snmp.yml
    ├── reports
    │   ├── junos-fw-grpc-counters.star
    │   ├── junos-fw-grpc-memory.star
    │   ├── junos-fw-grpc-policers.star
    │   ├── junos-fw-grpc.yml
    │   └── junos-fw-snmp.yml
    └── sources
        └── junos-fw-grpc.yml
```


#### Kentik Portal
After restarting kagent, we look at the Portal for the results in the three different paths.

Here are the **Memory** metrics for our fitlers:
{{&lt; image src=&#34;img_004.png&#34; caption=&#34;GRPC Memory metrics&#34; &gt;}}

The **Counter** metrics:
{{&lt; image src=&#34;img_005.png&#34; caption=&#34;GRPC Counter metrics&#34; &gt;}}

And the **Policer** one&#39;s:
{{&lt; image src=&#34;img_006.png&#34; caption=&#34;GRPC Policer metrics&#34; &gt;}}


---
## IOS-XR Flowspec

Let&#39;s do the same now for the XRs. Since there is no SNMP for flowspec but there is a dedicated yang model for it let’s see what gnmic has to say:
```JSON
get -e json_ietf --path Cisco-IOS-XR-flowspec-oper:flow-spec/vrfs/vrf/afs/af/flows/flow/
[
  {
    &#34;source&#34;: &#34;10.12.255.1&#34;,
    &#34;timestamp&#34;: 1714928869517180944,
    &#34;time&#34;: &#34;2024-05-05T20:07:49.517180944&#43;03:00&#34;,
    &#34;updates&#34;: [
      {
        &#34;Path&#34;: &#34;Cisco-IOS-XR-flowspec-oper:flow-spec/vrfs/vrf[vrf-name=default]/afs/af[af-name=IPv4]/flows/flow[flow-notation=Dest:10.11.10.10/32,Proto:=6,DPort:=5201]&#34;,
        &#34;values&#34;: {
          &#34;flow-spec/vrfs/vrf/afs/af/flows/flow&#34;: {
            &#34;active-flow-client&#34;: {
              &#34;action&#34;: [
                {
                  &#34;dscp&#34;: 0,
                  &#34;ipv4-nh&#34;: &#34;0.0.0.0&#34;,
                  &#34;ipv6-nh&#34;: &#34;::&#34;,
                  &#34;rate&#34;: &#34;40000&#34;
                }
              ]
            },
            &#34;flow-notation&#34;: &#34;Dest:10.11.10.10/32,Proto:=6,DPort:=5201&#34;,
            &#34;flow-statistics&#34;: {
              &#34;classified&#34;: {
                &#34;bytes&#34;: &#34;0&#34;,
                &#34;packets&#34;: &#34;0&#34;
              },
              &#34;dropped&#34;: {
                &#34;bytes&#34;: &#34;0&#34;,
                &#34;packets&#34;: &#34;0&#34;
              }
            },
            &#34;matches&#34;: {
              &#34;destination-port&#34;: {
                &#34;uint16_rng_array&#34;: [
                  {
                    &#34;max&#34;: 5201,
                    &#34;min&#34;: 5201
                  }
                ]
              },
              &#34;destination-prefix-ipv4&#34;: {
                &#34;mask&#34;: &#34;255.255.255.255&#34;,
                &#34;prefix&#34;: &#34;10.11.10.10&#34;
              },
              &#34;destination-prefix-ipv6&#34;: {
                &#34;mask&#34;: 0,
                &#34;prefix&#34;: &#34;::&#34;
              },
              &#34;icmp&#34;: {
                &#34;code&#34;: 0,
                &#34;type&#34;: 0
              },
              &#34;ip-protocol&#34;: {
                &#34;uint16_rng_array&#34;: [
                  {
                    &#34;max&#34;: 6,
                    &#34;min&#34;: 6
                  }
                ]
              },
              &#34;source-prefix-ipv4&#34;: {
                &#34;mask&#34;: &#34;0.0.0.0&#34;,
                &#34;prefix&#34;: &#34;0.0.0.0&#34;
              },
              &#34;source-prefix-ipv6&#34;: {
                &#34;mask&#34;: 0,
                &#34;prefix&#34;: &#34;::&#34;
              },
              &#34;tcp-flag&#34;: {
                &#34;match-any&#34;: false,
                &#34;value&#34;: 0
              }
            }
          }
        }
      },
      {
        &#34;Path&#34;: &#34;Cisco-IOS-XR-flowspec-oper:flow-spec/vrfs/vrf[vrf-name=default]/afs/af[af-name=IPv4]/flows/flow[flow-notation=Dest:10.11.10.10/32,ICMPType:=8]&#34;,
        &#34;values&#34;: {
          &#34;flow-spec/vrfs/vrf/afs/af/flows/flow&#34;: {
            &#34;active-flow-client&#34;: {
              &#34;action&#34;: [
                {
                  &#34;dscp&#34;: 0,
                  &#34;ipv4-nh&#34;: &#34;0.0.0.0&#34;,
                  &#34;ipv6-nh&#34;: &#34;::&#34;,
                  &#34;rate&#34;: &#34;0&#34;
                }
              ]
            },
            &#34;flow-notation&#34;: &#34;Dest:10.11.10.10/32,ICMPType:=8&#34;,
            &#34;flow-statistics&#34;: {
              &#34;classified&#34;: {
                &#34;bytes&#34;: &#34;0&#34;,
                &#34;packets&#34;: &#34;0&#34;
              },
              &#34;dropped&#34;: {
                &#34;bytes&#34;: &#34;0&#34;,
                &#34;packets&#34;: &#34;0&#34;
              }
            },
            &#34;matches&#34;: {
              &#34;destination-prefix-ipv4&#34;: {
                &#34;mask&#34;: &#34;255.255.255.255&#34;,
                &#34;prefix&#34;: &#34;10.11.10.10&#34;
              },
              &#34;destination-prefix-ipv6&#34;: {
                &#34;mask&#34;: 0,
                &#34;prefix&#34;: &#34;::&#34;
              },
              &#34;icmp&#34;: {
                &#34;code&#34;: 255,
                &#34;type&#34;: 8
              },
              &#34;source-prefix-ipv4&#34;: {
                &#34;mask&#34;: &#34;0.0.0.0&#34;,
                &#34;prefix&#34;: &#34;0.0.0.0&#34;
              },
              &#34;source-prefix-ipv6&#34;: {
                &#34;mask&#34;: 0,
                &#34;prefix&#34;: &#34;::&#34;
              },
              &#34;tcp-flag&#34;: {
                &#34;match-any&#34;: false,
                &#34;value&#34;: 0
              }
            }
          }
        }
      }
    ]
  }
]
```

And the equivalent list of paths:
```JSON
sub --mode once -e json_ietf --path Cisco-IOS-XR-flowspec-oper:flow-spec/vrfs/vrf/afs/af/flows/flow/ --format event
[
  {
    &#34;name&#34;: &#34;default-1714934425&#34;,
    &#34;timestamp&#34;: 1714934426719000000,
    &#34;tags&#34;: {
      &#34;af_af-name&#34;: &#34;IPv4&#34;,
      &#34;flow_flow-notation&#34;: &#34;Dest:10.11.10.10/32,Proto:=6,DPort:=5201&#34;,
      &#34;source&#34;: &#34;10.12.255.1:57344&#34;,
      &#34;subscription-name&#34;: &#34;default-1714934425&#34;,
      &#34;vrf_vrf-name&#34;: &#34;&#34;
    },
    &#34;values&#34;: {
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/active-flow-client/action.0/dscp&#34;: 0,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/active-flow-client/action.0/ipv4-nh&#34;: &#34;0.0.0.0&#34;,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/active-flow-client/action.0/ipv6-nh&#34;: &#34;::&#34;,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/active-flow-client/action.0/rate&#34;: &#34;40000&#34;,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/flow-statistics/classified/bytes&#34;: &#34;0&#34;,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/flow-statistics/classified/packets&#34;: &#34;0&#34;,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/flow-statistics/dropped/bytes&#34;: &#34;0&#34;,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/flow-statistics/dropped/packets&#34;: &#34;0&#34;,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/destination-port.0/max&#34;: 5201,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/destination-port.0/min&#34;: 5201,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/destination-prefix-ipv4/mask&#34;: &#34;255.255.255.255&#34;,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/destination-prefix-ipv4/prefix&#34;: &#34;10.11.10.10&#34;,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/destination-prefix-ipv6/mask&#34;: 0,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/destination-prefix-ipv6/prefix&#34;: &#34;::&#34;,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/icmp/code&#34;: 0,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/icmp/type&#34;: 0,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/ip-protocol.0/max&#34;: 6,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/ip-protocol.0/min&#34;: 6,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/source-prefix-ipv4/mask&#34;: &#34;0.0.0.0&#34;,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/source-prefix-ipv4/prefix&#34;: &#34;0.0.0.0&#34;,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/source-prefix-ipv6/mask&#34;: 0,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/source-prefix-ipv6/prefix&#34;: &#34;::&#34;,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/tcp-flag/match-any&#34;: false,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/tcp-flag/value&#34;: 0
    }
  }
]
[
  {
    &#34;name&#34;: &#34;default-1714934425&#34;,
    &#34;timestamp&#34;: 1714934426719000000,
    &#34;tags&#34;: {
      &#34;af_af-name&#34;: &#34;IPv4&#34;,
      &#34;flow_flow-notation&#34;: &#34;Dest:10.11.10.10/32,ICMPType:=8&#34;,
      &#34;source&#34;: &#34;10.12.255.1:57344&#34;,
      &#34;subscription-name&#34;: &#34;default-1714934425&#34;,
      &#34;vrf_vrf-name&#34;: &#34;&#34;
    },
    &#34;values&#34;: {
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/active-flow-client/action.0/dscp&#34;: 0,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/active-flow-client/action.0/ipv4-nh&#34;: &#34;0.0.0.0&#34;,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/active-flow-client/action.0/ipv6-nh&#34;: &#34;::&#34;,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/active-flow-client/action.0/rate&#34;: &#34;0&#34;,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/flow-statistics/classified/bytes&#34;: &#34;0&#34;,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/flow-statistics/classified/packets&#34;: &#34;0&#34;,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/flow-statistics/dropped/bytes&#34;: &#34;0&#34;,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/flow-statistics/dropped/packets&#34;: &#34;0&#34;,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/destination-prefix-ipv4/mask&#34;: &#34;255.255.255.255&#34;,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/destination-prefix-ipv4/prefix&#34;: &#34;10.11.10.10&#34;,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/destination-prefix-ipv6/mask&#34;: 0,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/destination-prefix-ipv6/prefix&#34;: &#34;::&#34;,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/icmp/code&#34;: 255,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/icmp/type&#34;: 8,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/source-prefix-ipv4/mask&#34;: &#34;0.0.0.0&#34;,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/source-prefix-ipv4/prefix&#34;: &#34;0.0.0.0&#34;,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/source-prefix-ipv6/mask&#34;: 0,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/source-prefix-ipv6/prefix&#34;: &#34;::&#34;,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/tcp-flag/match-any&#34;: false,
      &#34;Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/tcp-flag/value&#34;: 0
    }
  }
]
}
```

So we get the **actions** of the rule, the **statistics**, as well as the **match configuration** under the respective paths:

- `/flow-spec/vrfs/vrf/afs/af/flows/flow/active-flow-client/`
- `/flow-spec/vrfs/vrf/afs/af/flows/flow/flow-statistics/`
- `/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/`

#### Local Configuration
The _interesting_ metrics are under `/flow-statistics` and we get the tags for the `vrf` and the `address-family`. Let&#39;s configure _our_ local files.

&lt;p style=&#34;background-color:skyblue;text-align:center&#34;&gt;&lt;b&gt;Sources file&lt;/b&gt;&lt;/p&gt;

```YAML
version: 1
metadata:
  name: xrv-fspec-grpc
  kind: sources
sources:
  xrv-fspec-grpc: !gnmi
    path: Cisco-IOS-XR-flowspec-oper:flow-spec/vrfs/vrf/afs/af/flows/flow/
    mode: SAMPLE
    extra:
      sample_interval: 30s

```
&lt;p style=&#34;background-color:skyblue;text-align:center&#34;&gt;&lt;b&gt;Profiles file&lt;/b&gt;&lt;/p&gt;


```YAML
version: 1
metadata:
  name: xrv-fspec-grpc
  kind: profile
profile:
  match:
    sysobjectid:
      - 1.3.6.1.4.1.9.1.2264
    features:
      - gnmi
  reports:
    - xrv-fspec-grpc
  include:
    - device_name_ip
  sources:
    - xrv-fspec-grpc
```

&lt;p style=&#34;background-color:skyblue;text-align:center&#34;&gt;&lt;b&gt;Reports file&lt;/b&gt;&lt;/p&gt;

```YAML
version: 1
metadata:
  name: xrv-fspec-grpc
  kind: reports
reports:
  /xrv/flowspec/statistics:
    script: !external
      type: starlark
      file: xrv-fspec-grpc.star
    interval: 30s
```

&lt;p style=&#34;background-color:skyblue;text-align:center&#34;&gt;&lt;b&gt;XR Starlark Script&lt;/b&gt;&lt;/p&gt;

```python
load(&#34;ranger&#34;, &#34;source&#34;)
load(&#34;ranger&#34;, &#34;metric&#34;)
load(&#34;ranger&#34;, &#34;device&#34;)
load(&#34;ranger&#34;, &#34;log&#34;)

def execute(report):
    data = source.select(&#34;flow-spec/vrfs/vrf&#34;)

    for vrf_name, af_name, flow, statistics in [(
            i.get(&#39;vrf-name&#39;),
            y.get(&#39;af-name&#39;),
            z.get(&#39;flow-notation&#39;),
            z.get(&#34;flow-statistics&#34;)
        ) for i in data for y in i[&#39;afs&#39;][&#39;af&#39;] for z in y[&#39;flows&#39;][&#39;flow&#39;] ]:
        if vrf_name == &#34;&#34;:
            vrf_name = &#34;default&#34;
        record = report.append()
        record.append(&#34;vrf_name&#34;, vrf_name)
        record.append(&#34;af_name&#34;, af_name)
        record.append(&#34;flow_rule&#34;, flow)
        record.append(
            &#34;classified_bytes&#34;, statistics[&#39;classified&#39;].get(&#39;bytes&#39;),
            metric=True)
        record.append(
            &#34;classified_packets&#34;, statistics[&#39;classified&#39;].get(&#39;packets&#39;),
            metric=True)
        record.append(
            &#34;dropped_bytes&#34;, statistics[&#39;dropped&#39;].get(&#39;bytes&#39;), metric=True)
        record.append(
            &#34;dropped_packets&#34;, statistics[&#39;dropped&#39;].get(&#39;packets&#39;), metric=True)

        record.append(&#34;device_name&#34;, device().config.name)
        record.append(&#34;device_ip&#34;, device().config.host)

```

Here is our directory structure now with the new files added for XR:
{{&lt; highlight bash &#34;linenos=false,hl_lines=7 14-15 18&#34;&gt;}} 
override-data/
└── config
    ├── profiles
    │   ├── junos-fw-grpc.yml
    │   ├── junos-fw-snmp.yml
    │   └── xrv-fspec-grpc.yml
    ├── reports
    │   ├── junos-fw-grpc-counters.star
    │   ├── junos-fw-grpc-memory.star
    │   ├── junos-fw-grpc-policers.star
    │   ├── junos-fw-grpc.yml
    │   ├── junos-fw-snmp.yml
    │   ├── xrv-fspec-grpc.star
    │   └── xrv-fspec-grpc.yml
    └── sources
        ├── junos-fw-grpc.yml
        └── xrv-fspec-grpc.yml

{{&lt; /highlight &gt;}}

#### Kentik Portal
Restarting kagent to pick up the new configuration and here is what we get in the Portal under `/xrv/flowspec/statistics`, the configured path in our Reports file:

{{&lt; image src=&#34;img_007.png&#34; caption=&#34;XR Flowspec metrics&#34; &gt;}}

{{&lt; admonition note &#34;No XRv counters&#34; true&gt;}}
Unfortunately, XRv does not report those due to limitations of its virtual dataplane :cry:, but you get the picture
{{&lt; /admonition &gt;}}

---
## Outro

Well we covered enough ground to demonstrate what is possible currently with Kentik NMS when it comes to custom metrics:
- How to enable Kentik Universal Agent to poll for specific metrics from devices 
- Polling and reporting on a custom SNMP Table
- Polling and reporting on a custom ST path via GRPC
- Associating custom metrics to specific device types

&lt;p align=&#34;right&#34;&gt;&lt;br&gt;&lt;br&gt;&lt;i&gt;...till next time...have fun!!! &lt;/i&gt; &lt;/p&gt;

---
## Influences and Reference

- [How to Configure Kentik NMS to Collect Custom SNMP Metrics](https://www.kentik.com/blog/how-to-configure-kentik-nms-to-collect-custom-snmp-metrics/)
- [Adding Multiple Custom Metrics to Kentik NMS](https://www.kentik.com/blog/adding-multiple-custom-metrics-to-kentik-nms/)
- [Adjusting Data Before Sending It to Kentik NMS](https://www.kentik.com/blog/adjusting-data-before-sending-it-to-kentik-nms/)
- [Repo for this post](https://github.com/becos76/kentik-custom-metrics)


---

> Author:    
> URL: https://net4fungr.github.io/posts/kustom-metrics/  

