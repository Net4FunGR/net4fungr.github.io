# K~ustom Metrics in Kentik NMS

---
## Intro

Since the launch of Kentik NMS, it it is possible to ingest and display custom metrics in the Portal. In this post we will be going over a walkthrough of how we can enable Kentik's Universal Agent to poll custom SNMP and Streaming Telemetry metrics from devices and report them back to the Portal. The use case is about having visibility into BGP Flowspec counters to see what our mitigations are reporting on the devices. 

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
    ├── profiles        # Holds the configuration yaml files for 'binding' the sources to specific 'device' types
    ├── reports         # Holds the configuration yaml files for 'how' we want to report what is collected from the sources in the portal
    └── sources         # Holds the configuration yaml files for 'what' we want to poll from the device
```

So once kagent starts it looks for the `local` folder and it processes those files in the structure. For example, if we want to poll an SNMP OID for a device, we would need to create a configuration file under the `sources` directory specifying which OID to poll and how often. Then we need to _bind_ this source to only get polled if say the device is of a specific sysObjectID, and we do that in the `profiles` directory. Lastly, in the `reports` directory we define the path to present the data in the portal, how the data is represented and polled from the MIB, i.e. metrics or dimensions, and how often to update the values in the database. Additionally, in the `reports` directory we can use `starlark` scripts to add additional logic to our reporting capabilities.

### Kagent container

We are going to be running our kagent instance as a container through compose. Here is how our directory structure looks like:
```Bash
/opt/dev/kentik/
├── docker-compose.yml     # How to bring up the container
├── kagent-data            # Local dir mount so kagent data persists -> /opt/kentik in the container
└── override-data          # Local overrides directory with custom definitions -> /opt/kentik/components/ranger/local in the container
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
      - K_COMPANY_ID=<REDACTED>
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
netops@ATH-POP1-VMX1> show configuration firewall

netops@ATH-POP1-VMX1> show firewall detail

Filter: __default_bpdu_filter__
```
And here is what we get if we configure a filter to count SSH packets destined to the management IP of the device and two manual mitigations from the portal, one to block traffic and one to rate limit:
```Bash
netops@ATH-POP1-VMX1> show firewall detail

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
                "A list of firewalls entries.
                NOTE:  This table is deprecated and exists for backward
                compatibility.  The user is encouraged to use
                jnxFirewallCounterTable.  This table does not handle:
                1) counter and filter names greater than 24 characters
                2) counters with same names but different types (the first
                  duplicate is returned only)"


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


<p style="background-color:skyblue;text-align:center"><b>Sources file</b></p>

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
<p style="background-color:skyblue;text-align:center"><b>Profiles file</b></p>

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

<p style="background-color:skyblue;text-align:center"><b>Reports file</b></p>

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
I've used the same file name for these but it could be anything. Resources are referenced via the metadata name key and not by the filename.

#### Kagent Bring Up
Next step is to bring up the container and see what we get, but it seems there is an error:
```JSON
{"level":"error","error":"OID 1.3.6.1.4.1.2636.3.5.2 in table source jnxFirewallCounterTable 
 loaded from config/sources/snmp/juniper.yml also appears in table source junos-fw-snmp 
 loaded from sources/junos-fw-snmp.yml","time":"2024-05-03T16:51:41Z","message":"invalid config"}
```
This means that kagent is already configured to poll this OID from the file mentioned.
{{< admonition note "Kagent Default Config" true>}}
Kagent is pulling its _default configuration_ each time is brought up and this is in the `/opt/kentik/components/ranger/current/LATEST.zip` file
{{< /admonition >}}
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
{"level":"info","path":"../local/config","time":"2024-05-03T17:12:58Z",
 "message":"optional/override config directory exists, using"}
```

#### Kentik Portal
In the portal, the metrics are available under the configured path:

{{< image src="img_001.png" caption="SCHEMA path" width="400">}}


The table is populating:
{{< image src="img_002.png" caption="Junos Metrics Table" >}}




After a while the chart started graphing as well
{{< image src="img_003.png" caption="Junos Metrics Chart" >}}


### GRPC

Let’s try now to get the same via streaming telemetry and GRPC. According to [this](https://www.juniper.net/documentation/us/en/software/junos/interfaces-telemetry/topics/concept/junos-telemetry-interface-grpc-sensors.html) we can get those metrics under the `/junos/system/linecard/firewall` path.

Using gnmic (I could only get data via subscriptions and not get rpc calls):
```JSON
$ gnmic -a 10.11.255.1:32767 -u <username>-p <password> --skip-verify sub --mode once --path /junos/system/linecard/firewall
{
  "source": "10.11.255.1:32767",
  "subscription-name": "default-1714758367",
  "timestamp": 1714758371632000000,
  "time": "2024-05-03T20:46:11.632+03:00",
  "prefix": "junos/firewall[name=__default_bpdu_filter__]/state",
  "updates": [
    {
      "Path": "timestamp",
      "values": {
        "timestamp": 1714746658
      }
    },
    {
      "Path": "memory-usage[name=HEAP]/allocated",
      "values": {
        "memory-usage/allocated": 2596
      }
    }
  ]
}
{
  "source": "10.11.255.1:32767",
  "subscription-name": "default-1714758367",
  "timestamp": 1714758371632000000,
  "time": "2024-05-03T20:46:11.632+03:00",
  "prefix": "junos/firewall[name=TEST-FIREWALL]/state",
  "updates": [
    {
      "Path": "timestamp",
      "values": {
        "timestamp": 1714746658
      }
    },
    {
      "Path": "memory-usage[name=HEAP]/allocated",
      "values": {
        "memory-usage/allocated": 4004
      }
    },
    {
      "Path": "counter[name=SSH-PACKETS]/packets",
      "values": {
        "counter/packets": 1162
      }
    },
    {
      "Path": "counter[name=SSH-PACKETS]/bytes",
      "values": {
        "counter/bytes": 75400
      }
    }
  ]
}
{
  "source": "10.11.255.1:32767",
  "subscription-name": "default-1714758367",
  "timestamp": 1714758371632000000,
  "time": "2024-05-03T20:46:11.632+03:00",
  "prefix": "junos/firewall[name=__default_arp_policer__]/state",
  "updates": [
    {
      "Path": "timestamp",
      "values": {
        "timestamp": 1714403887
      }
    },
    {
      "Path": "memory-usage[name=HEAP]/allocated",
      "values": {
        "memory-usage/allocated": 1652
      }
    },
    {
      "Path": "policer[name=__default_arp_policer__]/out-of-spec-packets",
      "values": {
        "policer/out-of-spec-packets": 0
      }
    },
    {
      "Path": "policer[name=__default_arp_policer__]/out-of-spec-bytes",
      "values": {
        "policer/out-of-spec-bytes": 0
      }
    },
    {
      "Path": "policer[name=__default_arp_policer__]/offered-packets",
      "values": {
        "policer/offered-packets": 0
      }
    },
    {
      "Path": "policer[name=__default_arp_policer__]/offered-bytes",
      "values": {
        "policer/offered-bytes": 0
      }
    },
    {
      "Path": "policer[name=__default_arp_policer__]/transmitted-packets",
      "values": {
        "policer/transmitted-packets": 0
      }
    },
    {
      "Path": "policer[name=__default_arp_policer__]/transmitted-bytes",
      "values": {
        "policer/transmitted-bytes": 0
      }
    }
  ]
}
{
  "source": "10.11.255.1:32767",
  "subscription-name": "default-1714758367",
  "timestamp": 1714758371632000000,
  "time": "2024-05-03T20:46:11.632+03:00",
  "prefix": "junos/firewall[name=__flowspec_default_inet__]/state",
  "updates": [
    {
      "Path": "timestamp",
      "values": {
        "timestamp": 1714753321
      }
    },
    {
      "Path": "memory-usage[name=HEAP]/allocated",
      "values": {
        "memory-usage/allocated": 7172
      }
    },
    {
      "Path": "counter[name=10.11.10.10,*,icmp-type=8]/packets",
      "values": {
        "counter/packets": 1315
      }
    },
    {
      "Path": "counter[name=10.11.10.10,*,icmp-type=8]/bytes",
      "values": {
        "counter/bytes": 1876476
      }
    },
    {
      "Path": "counter[name=10.11.10.10,*,proto=6,dstport=5201]/packets",
      "values": {
        "counter/packets": 3311
      }
    },
    {
      "Path": "counter[name=10.11.10.10,*,proto=6,dstport=5201]/bytes",
      "values": {
        "counter/bytes": 4738920
      }
    },
    {
      "Path": "policer[name=40K_10.11.10.10,*,proto=6,dstport=5201]/out-of-spec-packets",
      "values": {
        "policer/out-of-spec-packets": 6891
      }
    },
    {
      "Path": "policer[name=40K_10.11.10.10,*,proto=6,dstport=5201]/out-of-spec-bytes",
      "values": {
        "policer/out-of-spec-bytes": 10336500
      }
    },
    {
      "Path": "policer[name=40K_10.11.10.10,*,proto=6,dstport=5201]/offered-packets",
      "values": {
        "policer/offered-packets": 0
      }
    },
    {
      "Path": "policer[name=40K_10.11.10.10,*,proto=6,dstport=5201]/offered-bytes",
      "values": {
        "policer/offered-bytes": 0
      }
    },
    {
      "Path": "policer[name=40K_10.11.10.10,*,proto=6,dstport=5201]/transmitted-packets",
      "values": {
        "policer/transmitted-packets": 0
      }
    },
    {
      "Path": "policer[name=40K_10.11.10.10,*,proto=6,dstport=5201]/transmitted-bytes",
      "values": {
        "policer/transmitted-bytes": 0
      }
    }
  ]
}
{
  "source": "10.11.255.1:32767",
  "subscription-name": "default-1714758367",
  "timestamp": 1714758371633000000,
  "time": "2024-05-03T20:46:11.633+03:00",
  "prefix": "junos/firewall[name=__default_bpdu_filter__]/state",
  "updates": [
    {
      "Path": "timestamp",
      "values": {
        "timestamp": 1714746658
      }
    },
    {
      "Path": "memory-usage[name=HEAP]/allocated",
      "values": {
        "memory-usage/allocated": 2596
      }
    }
  ]
}
{
  "source": "10.11.255.1:32767",
  "subscription-name": "default-1714758367",
  "timestamp": 1714758371633000000,
  "time": "2024-05-03T20:46:11.633+03:00",
  "prefix": "junos/firewall[name=TEST-FIREWALL]/state",
  "updates": [
    {
      "Path": "timestamp",
      "values": {
        "timestamp": 1714746658
      }
    },
    {
      "Path": "memory-usage[name=HEAP]/allocated",
      "values": {
        "memory-usage/allocated": 4004
      }
    },
    {
      "Path": "counter[name=SSH-PACKETS]/packets",
      "values": {
        "counter/packets": 1162
      }
    },
    {
      "Path": "counter[name=SSH-PACKETS]/bytes",
      "values": {
        "counter/bytes": 75400
      }
    }
  ]
}
{
  "source": "10.11.255.1:32767",
  "subscription-name": "default-1714758367",
  "timestamp": 1714758371633000000,
  "time": "2024-05-03T20:46:11.633+03:00",
  "prefix": "junos/firewall[name=__default_arp_policer__]/state",
  "updates": [
    {
      "Path": "timestamp",
      "values": {
        "timestamp": 1714403887
      }
    },
    {
      "Path": "memory-usage[name=HEAP]/allocated",
      "values": {
        "memory-usage/allocated": 1652
      }
    }
  ]
}
{
  "source": "10.11.255.1:32767",
  "subscription-name": "default-1714758367",
  "timestamp": 1714758371633000000,
  "time": "2024-05-03T20:46:11.633+03:00",
  "prefix": "junos/firewall[name=__flowspec_default_inet__]/state",
  "updates": [
    {
      "Path": "timestamp",
      "values": {
        "timestamp": 1714753321
      }
    },
    {
      "Path": "memory-usage[name=HEAP]/allocated",
      "values": {
        "memory-usage/allocated": 7172
      }
    },
    {
      "Path": "counter[name=10.11.10.10,*,icmp-type=8]/packets",
      "values": {
        "counter/packets": 1315
      }
    },
    {
      "Path": "counter[name=10.11.10.10,*,icmp-type=8]/bytes",
      "values": {
        "counter/bytes": 1876476
      }
    },
    {
      "Path": "counter[name=10.11.10.10,*,proto=6,dstport=5201]/packets",
      "values": {
        "counter/packets": 3311
      }
    },
    {
      "Path": "counter[name=10.11.10.10,*,proto=6,dstport=5201]/bytes",
      "values": {
        "counter/bytes": 4738920
      }
    },
    {
      "Path": "policer[name=40K_10.11.10.10,*,proto=6,dstport=5201]/out-of-spec-packets",
      "values": {
        "policer/out-of-spec-packets": 6891
      }
    },
    {
      "Path": "policer[name=40K_10.11.10.10,*,proto=6,dstport=5201]/out-of-spec-bytes",
      "values": {
        "policer/out-of-spec-bytes": 10336500
      }
    }
  ]
}
```

Let's briefly look at the paths returned to better understand what we are getting via this subscription:
```YAML
$ gnmic -a 10.11.255.1:32767 -u <username> -p <password> --skip-verify sub --mode once --path /junos/system/linecard/firewall | grep -e prefix -e Path
  "prefix": "junos/firewall[name=__default_bpdu_filter__]/state",
      "Path": "timestamp",
      "Path": "memory-usage[name=HEAP]/allocated",
  "prefix": "junos/firewall[name=TEST-FIREWALL]/state",
      "Path": "timestamp",
      "Path": "memory-usage[name=HEAP]/allocated",
      "Path": "counter[name=SSH-PACKETS]/packets",
      "Path": "counter[name=SSH-PACKETS]/bytes",
  "prefix": "junos/firewall[name=__default_arp_policer__]/state",
      "Path": "timestamp",
      "Path": "memory-usage[name=HEAP]/allocated",
      "Path": "policer[name=__default_arp_policer__]/out-of-spec-packets",
      "Path": "policer[name=__default_arp_policer__]/out-of-spec-bytes",
      "Path": "policer[name=__default_arp_policer__]/offered-packets",
      "Path": "policer[name=__default_arp_policer__]/offered-bytes",
      "Path": "policer[name=__default_arp_policer__]/transmitted-packets",
      "Path": "policer[name=__default_arp_policer__]/transmitted-bytes",
  "prefix": "junos/firewall[name=__flowspec_default_inet__]/state",
      "Path": "timestamp",
      "Path": "memory-usage[name=HEAP]/allocated",
      "Path": "counter[name=10.11.10.10,*,icmp-type=8]/packets",
      "Path": "counter[name=10.11.10.10,*,icmp-type=8]/bytes",
      "Path": "counter[name=10.11.10.10,*,proto=6,dstport=5201]/packets",
      "Path": "counter[name=10.11.10.10,*,proto=6,dstport=5201]/bytes",
      "Path": "policer[name=40K_10.11.10.10,*,proto=6,dstport=5201]/out-of-spec-packets",
      "Path": "policer[name=40K_10.11.10.10,*,proto=6,dstport=5201]/out-of-spec-bytes",
      "Path": "policer[name=40K_10.11.10.10,*,proto=6,dstport=5201]/offered-packets",
      "Path": "policer[name=40K_10.11.10.10,*,proto=6,dstport=5201]/offered-bytes",
      "Path": "policer[name=40K_10.11.10.10,*,proto=6,dstport=5201]/transmitted-packets",
      "Path": "policer[name=40K_10.11.10.10,*,proto=6,dstport=5201]/transmitted-bytes",
  "prefix": "junos/firewall[name=__default_bpdu_filter__]/state",
      "Path": "timestamp",
      "Path": "memory-usage[name=HEAP]/allocated",
  "prefix": "junos/firewall[name=TEST-FIREWALL]/state",
      "Path": "timestamp",
      "Path": "memory-usage[name=HEAP]/allocated",
      "Path": "counter[name=SSH-PACKETS]/packets",
      "Path": "counter[name=SSH-PACKETS]/bytes",
  "prefix": "junos/firewall[name=__default_arp_policer__]/state",
      "Path": "timestamp",
      "Path": "memory-usage[name=HEAP]/allocated",
  "prefix": "junos/firewall[name=__flowspec_default_inet__]/state",
      "Path": "timestamp",
      "Path": "memory-usage[name=HEAP]/allocated",
      "Path": "counter[name=10.11.10.10,*,icmp-type=8]/packets",
      "Path": "counter[name=10.11.10.10,*,icmp-type=8]/bytes",
      "Path": "counter[name=10.11.10.10,*,proto=6,dstport=5201]/packets",
      "Path": "counter[name=10.11.10.10,*,proto=6,dstport=5201]/bytes",
      "Path": "policer[name=40K_10.11.10.10,*,proto=6,dstport=5201]/out-of-spec-packets",
      "Path": "policer[name=40K_10.11.10.10,*,proto=6,dstport=5201]/out-of-spec-bytes",
```

It looks like we are getting the allocated memory per filter and the relevant metrics according to if the filter is a counter or policer. Let's create the relevant local overrides files. In the reports file we need extra processing on the data returned from the subscription before it is stored in the database and this is done via the use of starlark scripts.

#### Local Configuration (take 1)

<p style="background-color:skyblue;text-align:center"><b>Sources file</b></p>

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
<p style="background-color:skyblue;text-align:center"><b>Profiles file</b></p>


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

<p style="background-color:skyblue;text-align:center"><b>Reports file</b></p>

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

<p style="background-color:skyblue;text-align:center"><b>Basic Starlark Script</b></p>

```python
load("ranger", "source")
load("ranger", "metric")
load("ranger", "device")
load("ranger", "log")

def execute(report):
    log("###### STARTING STRALARK #######")
    data = source.select("junos/firewall")
    log(data)
    log("###### STRALARK FINISHED #######")
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
    "state": {
      "timestamp": 1714746658,
      "memory-usage": [
        {
          "allocated": 2596,
          "name": "HEAP"
        }
      ]
    },
    "name": "__default_bpdu_filter__"
  },
  {
    "state": {
      "timestamp": 1714746658,
      "memory-usage": [
        {
          "allocated": 4004,
          "name": "HEAP"
        }
      ],
      "counter": [
        {
          "packets": 1341,
          "bytes": 88064,
          "name": "SSH-PACKETS"
        }
      ]
    },
    "name": "TEST-FIREWALL"
  },
  {
    "state": {
      "policer": [
        {
          "out-of-spec-packets": 0,
          "out-of-spec-bytes": 0,
          "offered-packets": 0,
          "offered-bytes": 0,
          "transmitted-packets": 0,
          "transmitted-bytes": 0,
          "name": "__default_arp_policer__"
        }
      ],
      "timestamp": 1714403887,
      "memory-usage": [
        {
          "allocated": 1652,
          "name": "HEAP"
        }
      ]
    },
    "name": "__default_arp_policer__"
  },
  {
    "state": {
      "timestamp": 1714753321,
      "memory-usage": [
        {
          "allocated": 7172,
          "name": "HEAP"
        }
      ],
      "counter": [
        {
          "packets": 36574,
          "bytes": 52226328,
          "name": "10.11.10.10,*,icmp-type=8"
        },
        {
          "packets": 6336,
          "bytes": 9216704,
          "name": "10.11.10.10,*,proto=6,dstport=5201"
        }
      ],
      "policer": [
        {
          "out-of-spec-packets": 13378,
          "out-of-spec-bytes": 20067000,
          "offered-packets": 0,
          "offered-bytes": 0,
          "transmitted-packets": 0,
          "transmitted-bytes": 0,
          "name": "40K_10.11.10.10,*,proto=6,dstport=5201"
        }
      ]
    },
    "name": "__flowspec_default_inet__"
  }
]
```

So we got a list of dictionaries. One dictionary per firewall filter containing the allocated memory and the counter or policer names and metrics. Now since the counter metrics are different from the policer one's, it seems wise to report them in different paths on the portal schema. For example:

- `/junos/firewall/filter/memory/` → will hold the allocated memory for each filter
- `/junos/firewall/filter/counters/` → will hold the counter metrics
- `/junos/firewall/filter/policers/` → will hold the policer metrics

#### Local Configuration (take 2)

<p style="background-color:skyblue;text-align:center"><b>Reports - different paths</b></p>
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


<p style="background-color:skyblue;text-align:center"><b>Starlark - Memory</b></p>

```python
load("ranger", "source")
load("ranger", "metric")
load("ranger", "device")
load("ranger", "log")

def execute(report):
    log("###### STLRK - MEMORY START #######")
    data = source.select("junos/firewall")

    if data:
        # iterate over non empty dicts in the list
        for name, memory in  [
            (_.get('name'),
             _['state']['memory-usage'][0]['allocated']
             ) for _ in data if _]:
            record = report.append()
            record.append("filter_name", name)
            record.append("allocated_memory", memory, metric=True)
            record.append("device_name", device().config.name)
            record.append("device_ip", device().config.host)
        log("###### STLRK - MEMORY END #######")
    else:
        log("###### STLRK - MEMORY *** EMPTY **** #######")
```

<p style="background-color:skyblue;text-align:center"><b>Starlark - Counters</b></p>

```python
load("ranger", "source")
load("ranger", "metric")
load("ranger", "device")
load("ranger", "log")

def execute(report):
    log("###### STLRK - COUNTERS START #######")
    data = source.select("junos/firewall")

    if data:
        # iterate over non empty dicts that have counter key
        for fname, state in  [
            (_.get('name'),
             _.get('state')
             ) for _ in data if _ and _['state'].get('counter')] :

            for cname, packets, bytes in [
                (_.get('name') ,
                 _.get('packets'),
                 _.get('bytes')) for _ in state['counter'] ]:

                record = report.append()
                record.append("filter_name", fname)
                record.append("counter_name", cname)
                record.append("packets", packets, metric=True)
                record.append("bytes", bytes, metric=True)
                record.append("device_name", device().config.name)
                record.append("device_ip", device().config.host)

        log("###### STLRK - COUNTERS END #######")
    else:
        log("###### STLRK - COUNTERS *** EMPTY **** #######")
```

<p style="background-color:skyblue;text-align:center"><b>Starlark - Policers</b></p>

```python
load("ranger", "source")
load("ranger", "metric")
load("ranger", "device")
load("ranger", "log")

metrics = [
    'offered-bytes',
    'offered-packets',
    'out-of-spec-bytes',
    'out-of-spec-packets',
    'transmitted-bytes',
    'transmitted-packets'
]

def execute(report):
    log("###### STLRK - POLICER START #######")
    data = source.select("junos/firewall")

    if data:
        # iterate over non empty dicts that have policer key
        for fname, state in  [
            (_.get('name'),
             _.get('state')
             ) for _ in data if _ and _['state'].get('policer')]:

            for policer in state['policer']:
                record = report.append()
                record.append("filter_name", fname)
                record.append("policer_name", policer.pop('name'))
                # Get metrics defined statically above
                for key in metrics:
                    record.append(key, policer.get(key) , metric=True)
                record.append("device_name", device().config.name)
                record.append("device_ip", device().config.host)

        log("###### STLRK - POLICER END #######")
    else:
        log("###### STLRK - POLICER *** EMPTY **** #######")
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
{{< image src="img_004.png" caption="GRPC Memory metrics" >}}

The **Counter** metrics:
{{< image src="img_005.png" caption="GRPC Counter metrics" >}}

And the **Policer** one's:
{{< image src="img_006.png" caption="GRPC Policer metrics" >}}


---
## IOS-XR Flowspec

Let's do the same now for the XRs. Since there is no SNMP for flowspec but there is a dedicated yang model for it let’s see what gnmic has to say:
```JSON
get -e json_ietf --path Cisco-IOS-XR-flowspec-oper:flow-spec/vrfs/vrf/afs/af/flows/flow/
[
  {
    "source": "10.12.255.1",
    "timestamp": 1714928869517180944,
    "time": "2024-05-05T20:07:49.517180944+03:00",
    "updates": [
      {
        "Path": "Cisco-IOS-XR-flowspec-oper:flow-spec/vrfs/vrf[vrf-name=default]/afs/af[af-name=IPv4]/flows/flow[flow-notation=Dest:10.11.10.10/32,Proto:=6,DPort:=5201]",
        "values": {
          "flow-spec/vrfs/vrf/afs/af/flows/flow": {
            "active-flow-client": {
              "action": [
                {
                  "dscp": 0,
                  "ipv4-nh": "0.0.0.0",
                  "ipv6-nh": "::",
                  "rate": "40000"
                }
              ]
            },
            "flow-notation": "Dest:10.11.10.10/32,Proto:=6,DPort:=5201",
            "flow-statistics": {
              "classified": {
                "bytes": "0",
                "packets": "0"
              },
              "dropped": {
                "bytes": "0",
                "packets": "0"
              }
            },
            "matches": {
              "destination-port": {
                "uint16_rng_array": [
                  {
                    "max": 5201,
                    "min": 5201
                  }
                ]
              },
              "destination-prefix-ipv4": {
                "mask": "255.255.255.255",
                "prefix": "10.11.10.10"
              },
              "destination-prefix-ipv6": {
                "mask": 0,
                "prefix": "::"
              },
              "icmp": {
                "code": 0,
                "type": 0
              },
              "ip-protocol": {
                "uint16_rng_array": [
                  {
                    "max": 6,
                    "min": 6
                  }
                ]
              },
              "source-prefix-ipv4": {
                "mask": "0.0.0.0",
                "prefix": "0.0.0.0"
              },
              "source-prefix-ipv6": {
                "mask": 0,
                "prefix": "::"
              },
              "tcp-flag": {
                "match-any": false,
                "value": 0
              }
            }
          }
        }
      },
      {
        "Path": "Cisco-IOS-XR-flowspec-oper:flow-spec/vrfs/vrf[vrf-name=default]/afs/af[af-name=IPv4]/flows/flow[flow-notation=Dest:10.11.10.10/32,ICMPType:=8]",
        "values": {
          "flow-spec/vrfs/vrf/afs/af/flows/flow": {
            "active-flow-client": {
              "action": [
                {
                  "dscp": 0,
                  "ipv4-nh": "0.0.0.0",
                  "ipv6-nh": "::",
                  "rate": "0"
                }
              ]
            },
            "flow-notation": "Dest:10.11.10.10/32,ICMPType:=8",
            "flow-statistics": {
              "classified": {
                "bytes": "0",
                "packets": "0"
              },
              "dropped": {
                "bytes": "0",
                "packets": "0"
              }
            },
            "matches": {
              "destination-prefix-ipv4": {
                "mask": "255.255.255.255",
                "prefix": "10.11.10.10"
              },
              "destination-prefix-ipv6": {
                "mask": 0,
                "prefix": "::"
              },
              "icmp": {
                "code": 255,
                "type": 8
              },
              "source-prefix-ipv4": {
                "mask": "0.0.0.0",
                "prefix": "0.0.0.0"
              },
              "source-prefix-ipv6": {
                "mask": 0,
                "prefix": "::"
              },
              "tcp-flag": {
                "match-any": false,
                "value": 0
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
    "name": "default-1714934425",
    "timestamp": 1714934426719000000,
    "tags": {
      "af_af-name": "IPv4",
      "flow_flow-notation": "Dest:10.11.10.10/32,Proto:=6,DPort:=5201",
      "source": "10.12.255.1:57344",
      "subscription-name": "default-1714934425",
      "vrf_vrf-name": ""
    },
    "values": {
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/active-flow-client/action.0/dscp": 0,
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/active-flow-client/action.0/ipv4-nh": "0.0.0.0",
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/active-flow-client/action.0/ipv6-nh": "::",
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/active-flow-client/action.0/rate": "40000",
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/flow-statistics/classified/bytes": "0",
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/flow-statistics/classified/packets": "0",
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/flow-statistics/dropped/bytes": "0",
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/flow-statistics/dropped/packets": "0",
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/destination-port.0/max": 5201,
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/destination-port.0/min": 5201,
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/destination-prefix-ipv4/mask": "255.255.255.255",
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/destination-prefix-ipv4/prefix": "10.11.10.10",
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/destination-prefix-ipv6/mask": 0,
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/destination-prefix-ipv6/prefix": "::",
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/icmp/code": 0,
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/icmp/type": 0,
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/ip-protocol.0/max": 6,
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/ip-protocol.0/min": 6,
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/source-prefix-ipv4/mask": "0.0.0.0",
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/source-prefix-ipv4/prefix": "0.0.0.0",
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/source-prefix-ipv6/mask": 0,
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/source-prefix-ipv6/prefix": "::",
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/tcp-flag/match-any": false,
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/tcp-flag/value": 0
    }
  }
]
[
  {
    "name": "default-1714934425",
    "timestamp": 1714934426719000000,
    "tags": {
      "af_af-name": "IPv4",
      "flow_flow-notation": "Dest:10.11.10.10/32,ICMPType:=8",
      "source": "10.12.255.1:57344",
      "subscription-name": "default-1714934425",
      "vrf_vrf-name": ""
    },
    "values": {
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/active-flow-client/action.0/dscp": 0,
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/active-flow-client/action.0/ipv4-nh": "0.0.0.0",
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/active-flow-client/action.0/ipv6-nh": "::",
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/active-flow-client/action.0/rate": "0",
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/flow-statistics/classified/bytes": "0",
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/flow-statistics/classified/packets": "0",
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/flow-statistics/dropped/bytes": "0",
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/flow-statistics/dropped/packets": "0",
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/destination-prefix-ipv4/mask": "255.255.255.255",
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/destination-prefix-ipv4/prefix": "10.11.10.10",
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/destination-prefix-ipv6/mask": 0,
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/destination-prefix-ipv6/prefix": "::",
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/icmp/code": 255,
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/icmp/type": 8,
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/source-prefix-ipv4/mask": "0.0.0.0",
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/source-prefix-ipv4/prefix": "0.0.0.0",
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/source-prefix-ipv6/mask": 0,
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/source-prefix-ipv6/prefix": "::",
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/tcp-flag/match-any": false,
      "Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/tcp-flag/value": 0
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
The _interesting_ metrics are under `/flow-statistics` and we get the tags for the `vrf` and the `address-family`. Let's configure _our_ local files.

<p style="background-color:skyblue;text-align:center"><b>Sources file</b></p>

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
<p style="background-color:skyblue;text-align:center"><b>Profiles file</b></p>


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

<p style="background-color:skyblue;text-align:center"><b>Reports file</b></p>

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

<p style="background-color:skyblue;text-align:center"><b>XR Starlark Script</b></p>

```python
load("ranger", "source")
load("ranger", "metric")
load("ranger", "device")
load("ranger", "log")

def execute(report):
    data = source.select("flow-spec/vrfs/vrf")

    for vrf_name, af_name, flow, statistics in [(
            i.get('vrf-name'),
            y.get('af-name'),
            z.get('flow-notation'),
            z.get("flow-statistics")
        ) for i in data for y in i['afs']['af'] for z in y['flows']['flow'] ]:
        if vrf_name == "":
            vrf_name = "default"
        record = report.append()
        record.append("vrf_name", vrf_name)
        record.append("af_name", af_name)
        record.append("flow_rule", flow)
        record.append(
            "classified_bytes", statistics['classified'].get('bytes'),
            metric=True)
        record.append(
            "classified_packets", statistics['classified'].get('packets'),
            metric=True)
        record.append(
            "dropped_bytes", statistics['dropped'].get('bytes'), metric=True)
        record.append(
            "dropped_packets", statistics['dropped'].get('packets'), metric=True)

        record.append("device_name", device().config.name)
        record.append("device_ip", device().config.host)

```

Here is our directory structure now with the new files added for XR:
{{< highlight bash "linenos=false,hl_lines=7 14-15 18">}} 
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

{{< /highlight >}}

#### Kentik Portal
Restarting kagent to pick up the new configuration and here is what we get in the Portal under `/xrv/flowspec/statistics`, the configured path in our Reports file:

{{< image src="img_007.png" caption="XR Flowspec metrics" >}}

{{< admonition note "No XRv counters" true>}}
Unfortunately, XRv does not report those due to limitations of its virtual dataplane :cry:, but you get the picture
{{< /admonition >}}

---
## Outro

Well we covered enough ground to demonstrate what is possible currently with Kentik NMS when it comes to custom metrics:
- How to enable Kentik Universal Agent to poll for specific metrics from devices 
- Polling and reporting on a custom SNMP Table
- Polling and reporting on a custom ST path via GRPC
- Associating custom metrics to specific device types

<p align="right"><br><br><i>...till next time...have fun!!! </i> </p>

---
## Influences and Reference

- [How to Configure Kentik NMS to Collect Custom SNMP Metrics](https://www.kentik.com/blog/how-to-configure-kentik-nms-to-collect-custom-snmp-metrics/)
- [Adding Multiple Custom Metrics to Kentik NMS](https://www.kentik.com/blog/adding-multiple-custom-metrics-to-kentik-nms/)
- [Adjusting Data Before Sending It to Kentik NMS](https://www.kentik.com/blog/adjusting-data-before-sending-it-to-kentik-nms/)
- [Repo for this post](https://github.com/becos76/kentik-custom-metrics)


---

> Author:    
> URL: https://net4fungr.github.io/posts/kustom-metrics/  

