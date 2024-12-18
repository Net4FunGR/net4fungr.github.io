# IOS-XR :: Get Your XPATHs, Get Your XPATHs Honey

One of the mostly raised questions when you start leveraging MDT is which YANG model and xpath to use to configure the subscription on the device.  Up to now, there was little to none help from the box itself, and a lot of searching and experimentation on the models was needed. Apparently this has changed now, and there are two sets of commands that will help in your quest.

Let&#39;s jump on [DevNet&#39;s always-on XRv9000](https://devnetsandbox.cisco.com/RM/Diagram/Index/e83cfd31-ade3-4e15-91d6-3118b867a0dd?diagramType=Topology) sandbox and issue some commands.

```auto {hl_lines=[9 17]}
$ ssh admin@sandbox-iosxr-1.cisco.com

Password:


RP/0/RP0/CPU0:ansible-iosxr#
RP/0/RP0/CPU0:ansible-iosxr#show version
Sun Jul 10 22:02:49.475 UTC
Cisco IOS XR Software, Version 7.3.2
Copyright (c) 2013-2021 by Cisco Systems, Inc.

Build Information:
 Built By     : ingunawa
 Built On     : Wed Oct 13 20:00:36 PDT 2021
 Built Host   : iox-ucs-017
 Workspace    : /auto/srcarchive17/prod/7.3.2/xrv9k/ws
 Version      : 7.3.2
 Location     : /opt/cisco/XR/packages/
 Label        : 7.3.2-0

cisco IOS-XRv 9000 () processor
System uptime is 2 weeks 5 days 10 hours 35 minutes

```

Let&#39;s say we want to find out which model and xpath will give us the sensors for `show interfaces`. There was the _old_ command `schema-describe`, but now there is a new kid in town called `show telemetry internal` that does the trick.

```auto {hl_lines=8}
RP/0/RP0/CPU0:ansible-iosxr#schema-describe &#34;show interfaces&#34;
Sun Jul 10 22:09:54.304 UTC
Action: get
Path:   RootOper.Interfaces.Interface

RP/0/RP0/CPU0:ansible-iosxr#show telemetry internal xpath &#34;show interfaces&#34;
Sun Jul 10 22:11:04.759 UTC
Cisco-IOS-XR-pfi-im-cmd-oper:interfaces/interface-xr/interface

```
So now, we&#39;ve got the model and xpath, let&#39;s see what will be streamed for just the Bundle interfaces

```json
RP/0/RP0/CPU0:ansible-iosxr#show telemetry internal json Cisco-IOS-XR-pfi-im-cmd-oper:interfaces/interface-xr/interface[interface-name=&#39;Bundle-*&#39;]
Sun Jul 10 22:24:38.169 UTC
{
  &#34;encoding_path&#34;: &#34;Cisco-IOS-XR-pfi-im-cmd-oper:interfaces/interface-xr/interface&#34;,
  &#34;subscription_id_str&#34;: &#34;app_TEST_200000001&#34;,
  &#34;collection_start_time&#34;: &#34;1657491878258&#34;,
  &#34;msg_timestamp&#34;: &#34;1657491878577&#34;,
  &#34;collection_end_time&#34;: &#34;1657491878577&#34;,
  &#34;node_id_str&#34;: &#34;ansible-iosxr&#34;,
  &#34;data_json&#34;: [
    {
      &#34;keys&#34;: [
        {
          &#34;interface-name&#34;: &#34;Bundle-Ether10&#34;
        }
      ],
      &#34;timestamp&#34;: &#34;1657491878321&#34;,
      &#34;content&#34;: {
        &#34;bandwidth64-bit&#34;: &#34;0&#34;,
        &#34;data-rates&#34;: {
          &#34;peak-output-data-rate&#34;: &#34;0&#34;,
          &#34;input-load&#34;: 0,
          &#34;input-packet-rate&#34;: &#34;0&#34;,
          &#34;output-data-rate&#34;: &#34;0&#34;,
          &#34;peak-input-packet-rate&#34;: &#34;0&#34;,
          &#34;bandwidth&#34;: &#34;0&#34;,
          &#34;load-interval&#34;: 9,
          &#34;output-packet-rate&#34;: &#34;0&#34;,
          &#34;input-data-rate&#34;: &#34;0&#34;,
          &#34;peak-output-packet-rate&#34;: &#34;0&#34;,
          &#34;reliability&#34;: 255,
          &#34;peak-input-data-rate&#34;: &#34;0&#34;,
          &#34;output-load&#34;: 0
        },
        &#34;interface-type&#34;: &#34;IFT_ETHERBUNDLE&#34;,
        &#34;bandwidth&#34;: 0,
        &#34;fast-shutdown&#34;: false,
        &#34;is-intf-logical&#34;: true,
        &#34;speed&#34;: 0,
        &#34;interface-type-information&#34;: {
          &#34;bundle-information&#34;: {},
          &#34;interface-type-info&#34;: &#34;bundle&#34;
        },
        &#34;loopback-configuration&#34;: &#34;no-loopback&#34;,
        &#34;state-transition-count&#34;: 0,
        &#34;last-state-transition-time&#34;: &#34;0&#34;,
        &#34;interface-handle&#34;: &#34;Bundle-Ether10&#34;,
        &#34;is-dampening-enabled&#34;: false,
        &#34;state&#34;: &#34;im-state-down&#34;,
        &#34;mac-address&#34;: {
          &#34;address&#34;: &#34;00:08:20:78:ff:1d&#34;
        },
        &#34;hardware-type-string&#34;: &#34;Aggregated Ethernet interface(s)&#34;,
        &#34;is-l2-looped&#34;: false,
        &#34;line-state&#34;: &#34;im-state-down&#34;,
        &#34;encapsulation&#34;: &#34;ether&#34;,
        &#34;encapsulation-type-string&#34;: &#34;ARPA&#34;,
        &#34;is-l2-transport-enabled&#34;: true,
        &#34;duplexity&#34;: &#34;im-attr-duplex-full&#34;,
        &#34;mtu&#34;: 1514,
        &#34;max-bandwidth64-bit&#34;: &#34;0&#34;,
        &#34;if-index&#34;: 28,
        &#34;max-bandwidth&#34;: 0
      }
    }
  ],
  &#34;collection_id&#34;: &#34;54&#34;
},
```
Or, by using the old method:

```json
RP/0/RP0/CPU0:ansible-iosxr#run mdt_exec -s Cisco-IOS-XR-pfi-im-cmd-oper:interfaces/interface-xr/interface[interface-name=&#39;Bundle-*&#39;]
Sun Jul 10 22:26:48.133 UTC
Enter any key to exit...
 Sub_id 200000001, flag 0, len 0
 Sub_id 200000001, flag 4, len 1440
--------
{&#34;node_id_str&#34;:&#34;ansible-iosxr&#34;,&#34;subscription_id_str&#34;:&#34;app_TEST_200000001&#34;,
&#34;encoding_path&#34;:&#34;Cisco-IOS-XR-pfi-im-cmd-oper:interfaces/interface-xr/interface&#34;,
&#34;collection_id&#34;:&#34;55&#34;,&#34;collection_start_time&#34;:&#34;1657492008249&#34;,&#34;msg_timestamp&#34;:&#34;1657492008548&#34;,
&#34;data_json&#34;:[{&#34;timestamp&#34;:&#34;1657492008306&#34;,&#34;keys&#34;:[{&#34;interface-name&#34;:&#34;Bundle-Ether10&#34;}],
&#34;content&#34;:{&#34;interface-handle&#34;:&#34;Bundle-Ether10&#34;,&#34;interface-type&#34;:&#34;IFT_ETHERBUNDLE&#34;,
&#34;hardware-type-string&#34;:&#34;Aggregated Ethernet interface(s)&#34;,&#34;state&#34;:&#34;im-state-down&#34;,
&#34;line-state&#34;:&#34;im-state-down&#34;,&#34;encapsulation&#34;:&#34;ether&#34;,&#34;encapsulation-type-string&#34;:&#34;ARPA&#34;,
&#34;mtu&#34;:1514,&#34;is-l2-transport-enabled&#34;:true,&#34;state-transition-count&#34;:0,
&#34;last-state-transition-time&#34;:&#34;0&#34;,&#34;is-dampening-enabled&#34;:false,&#34;speed&#34;:0,
&#34;duplexity&#34;:&#34;im-attr-duplex-full&#34;,&#34;mac-address&#34;:{&#34;address&#34;:&#34;00:08:20:78:ff:1d&#34;},&#34;bandwidth&#34;:0,
&#34;max-bandwidth&#34;:0,&#34;is-l2-looped&#34;:false,&#34;loopback-configuration&#34;:&#34;no-loopback&#34;,
&#34;fast-shutdown&#34;:false,&#34;interface-type-information&#34;:{&#34;interface-type-info&#34;:&#34;bundle&#34;,
&#34;bundle-information&#34;:{}},&#34;data-rates&#34;:{&#34;input-data-rate&#34;:&#34;0&#34;,&#34;input-packet-rate&#34;:&#34;0&#34;,
&#34;output-data-rate&#34;:&#34;0&#34;,&#34;output-packet-rate&#34;:&#34;0&#34;,&#34;peak-input-data-rate&#34;:&#34;0&#34;,
&#34;peak-input-packet-rate&#34;:&#34;0&#34;,&#34;peak-output-data-rate&#34;:&#34;0&#34;,&#34;peak-output-packet-rate&#34;:&#34;0&#34;,
&#34;bandwidth&#34;:&#34;0&#34;,&#34;load-interval&#34;:9,&#34;output-load&#34;:0,&#34;input-load&#34;:0,&#34;reliability&#34;:255},
&#34;if-index&#34;:28,&#34;is-intf-logical&#34;:true,&#34;bandwidth64-bit&#34;:&#34;0&#34;,&#34;max-bandwidth64-bit&#34;:&#34;0&#34;}}],
&#34;collection_end_time&#34;:&#34;1657492008549&#34;}
--------
 Sub_id 200000001, flag 8, len 0
 ```
Now, let&#39;s try to _start_ from an openconfig model.
```json
RP/0/RP0/CPU0:ansible-iosxr#show telemetry internal xpath openconfig-interfaces
Sun Jul 10 22:39:52.953 UTC
openconfig-interfaces:interfaces/interface/state/counters
openconfig-interfaces:interfaces/interface
openconfig-interfaces:interfaces/interface/subinterfaces/subinterface/state/counters
openconfig-interfaces:interfaces/interface/state
openconfig-interfaces:interfaces/interface/hold-time
openconfig-interfaces:interfaces/interface/subinterfaces/subinterface

# Or old school

RP/0/RP0/CPU0:ansible-iosxr#run mdt_get_gather_paths openconfig-interfaces
Sun Jul 10 22:41:36.554 UTC
openconfig-interfaces:interfaces/interface/state/counters
openconfig-interfaces:interfaces/interface
openconfig-interfaces:interfaces/interface/subinterfaces/subinterface/state/counters
openconfig-interfaces:interfaces/interface/state
openconfig-interfaces:interfaces/interface/hold-time
openconfig-interfaces:interfaces/interface/subinterfaces/subinterface

RP/0/RP0/CPU0:ansible-iosxr#show telemetry internal json openconfig-interfaces:interfaces/interface[name=&#39;Bundle-*&#39;]/state/counters
Sun Jul 10 22:43:59.255 UTC
{
  &#34;encoding_path&#34;: &#34;openconfig-interfaces:interfaces/interface/state&#34;,
  &#34;subscription_id_str&#34;: &#34;app_TEST_200000001&#34;,
  &#34;collection_start_time&#34;: &#34;1657493039807&#34;,
  &#34;msg_timestamp&#34;: &#34;1657493039813&#34;,
  &#34;collection_end_time&#34;: &#34;1657493039813&#34;,
  &#34;node_id_str&#34;: &#34;ansible-iosxr&#34;,
  &#34;data_json&#34;: [
    {
      &#34;keys&#34;: [
        {
          &#34;name&#34;: &#34;Bundle-Ether10&#34;
        }
      ],
      &#34;timestamp&#34;: &#34;1657493039812&#34;,
      &#34;content&#34;: {
        &#34;name&#34;: &#34;Bundle-Ether10&#34;,
        &#34;type&#34;: &#34;iana-if-type:ieee8023adLag&#34;,
        &#34;oper-status&#34;: &#34;DOWN&#34;,
        &#34;enabled&#34;: true,
        &#34;admin-status&#34;: &#34;UP&#34;,
        &#34;logical&#34;: true,
        &#34;mtu&#34;: 1514,
        &#34;ifindex&#34;: 28,
        &#34;last-change&#34;: &#34;0&#34;,
        &#34;loopback-mode&#34;: false,
        &#34;counters&#34;: {
          &#34;carrier-transitions&#34;: &#34;0&#34;
        }
      }
    }
  ],
  &#34;collection_id&#34;: &#34;70&#34;
},

```
That is all! Keep a note on the old commands that exists:
- **schema-describe** _&#34;show command&#34;_
- **run mdt_get_gather_paths** _\&lt;yang model\&gt;_
- **run mdt_exec** -s _\&lt;xpath\&gt;_ -c _\&lt;sample interval in msec\&gt;_

And the new one:
```
RP/0/RP0/CPU0:ansible-iosxr#show telemetry internal ?
  json   Display yang sensor paths data in json format
  xpath  Display yang sensor paths
```

Find out more on [xrdocs.io](https://xrdocs.io/), in the [telemetry tutorials](https://xrdocs.io/telemetry/tutorials/)

&lt;p align=&#34;right&#34;&gt;...till next time...&lt;em&gt;have fun!&lt;/em&gt;&lt;/p&gt;

---

> Author:    
> URL: https://net4fungr.github.io/posts/xr-get-xpath/  

