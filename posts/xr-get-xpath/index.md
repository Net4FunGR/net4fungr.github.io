# IOS-XR :: Get Your XPATHs, Get Your XPATHs Honey

One of the mostly raised questions when you start leveraging MDT is which YANG model and xpath to use to configure the subscription on the device.  Up to now, there was little to none help from the box itself, and a lot of searching and experimentation on the models was needed. Apparently this has changed now, and there are two sets of commands that will help in your quest.

Let's jump on [DevNet's always-on XRv9000](https://devnetsandbox.cisco.com/RM/Diagram/Index/e83cfd31-ade3-4e15-91d6-3118b867a0dd?diagramType=Topology) sandbox and issue some commands.

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

Let's say we want to find out which model and xpath will give us the sensors for `show interfaces`. There was the _old_ command `schema-describe`, but now there is a new kid in town called `show telemetry internal` that does the trick.

```auto {hl_lines=8}
RP/0/RP0/CPU0:ansible-iosxr#schema-describe "show interfaces"
Sun Jul 10 22:09:54.304 UTC
Action: get
Path:   RootOper.Interfaces.Interface

RP/0/RP0/CPU0:ansible-iosxr#show telemetry internal xpath "show interfaces"
Sun Jul 10 22:11:04.759 UTC
Cisco-IOS-XR-pfi-im-cmd-oper:interfaces/interface-xr/interface

```
So now, we've got the model and xpath, let's see what will be streamed for just the Bundle interfaces

```json
RP/0/RP0/CPU0:ansible-iosxr#show telemetry internal json Cisco-IOS-XR-pfi-im-cmd-oper:interfaces/interface-xr/interface[interface-name='Bundle-*']
Sun Jul 10 22:24:38.169 UTC
{
  "encoding_path": "Cisco-IOS-XR-pfi-im-cmd-oper:interfaces/interface-xr/interface",
  "subscription_id_str": "app_TEST_200000001",
  "collection_start_time": "1657491878258",
  "msg_timestamp": "1657491878577",
  "collection_end_time": "1657491878577",
  "node_id_str": "ansible-iosxr",
  "data_json": [
    {
      "keys": [
        {
          "interface-name": "Bundle-Ether10"
        }
      ],
      "timestamp": "1657491878321",
      "content": {
        "bandwidth64-bit": "0",
        "data-rates": {
          "peak-output-data-rate": "0",
          "input-load": 0,
          "input-packet-rate": "0",
          "output-data-rate": "0",
          "peak-input-packet-rate": "0",
          "bandwidth": "0",
          "load-interval": 9,
          "output-packet-rate": "0",
          "input-data-rate": "0",
          "peak-output-packet-rate": "0",
          "reliability": 255,
          "peak-input-data-rate": "0",
          "output-load": 0
        },
        "interface-type": "IFT_ETHERBUNDLE",
        "bandwidth": 0,
        "fast-shutdown": false,
        "is-intf-logical": true,
        "speed": 0,
        "interface-type-information": {
          "bundle-information": {},
          "interface-type-info": "bundle"
        },
        "loopback-configuration": "no-loopback",
        "state-transition-count": 0,
        "last-state-transition-time": "0",
        "interface-handle": "Bundle-Ether10",
        "is-dampening-enabled": false,
        "state": "im-state-down",
        "mac-address": {
          "address": "00:08:20:78:ff:1d"
        },
        "hardware-type-string": "Aggregated Ethernet interface(s)",
        "is-l2-looped": false,
        "line-state": "im-state-down",
        "encapsulation": "ether",
        "encapsulation-type-string": "ARPA",
        "is-l2-transport-enabled": true,
        "duplexity": "im-attr-duplex-full",
        "mtu": 1514,
        "max-bandwidth64-bit": "0",
        "if-index": 28,
        "max-bandwidth": 0
      }
    }
  ],
  "collection_id": "54"
},
```
Or, by using the old method:

```json
RP/0/RP0/CPU0:ansible-iosxr#run mdt_exec -s Cisco-IOS-XR-pfi-im-cmd-oper:interfaces/interface-xr/interface[interface-name='Bundle-*']
Sun Jul 10 22:26:48.133 UTC
Enter any key to exit...
 Sub_id 200000001, flag 0, len 0
 Sub_id 200000001, flag 4, len 1440
--------
{"node_id_str":"ansible-iosxr","subscription_id_str":"app_TEST_200000001",
"encoding_path":"Cisco-IOS-XR-pfi-im-cmd-oper:interfaces/interface-xr/interface",
"collection_id":"55","collection_start_time":"1657492008249","msg_timestamp":"1657492008548",
"data_json":[{"timestamp":"1657492008306","keys":[{"interface-name":"Bundle-Ether10"}],
"content":{"interface-handle":"Bundle-Ether10","interface-type":"IFT_ETHERBUNDLE",
"hardware-type-string":"Aggregated Ethernet interface(s)","state":"im-state-down",
"line-state":"im-state-down","encapsulation":"ether","encapsulation-type-string":"ARPA",
"mtu":1514,"is-l2-transport-enabled":true,"state-transition-count":0,
"last-state-transition-time":"0","is-dampening-enabled":false,"speed":0,
"duplexity":"im-attr-duplex-full","mac-address":{"address":"00:08:20:78:ff:1d"},"bandwidth":0,
"max-bandwidth":0,"is-l2-looped":false,"loopback-configuration":"no-loopback",
"fast-shutdown":false,"interface-type-information":{"interface-type-info":"bundle",
"bundle-information":{}},"data-rates":{"input-data-rate":"0","input-packet-rate":"0",
"output-data-rate":"0","output-packet-rate":"0","peak-input-data-rate":"0",
"peak-input-packet-rate":"0","peak-output-data-rate":"0","peak-output-packet-rate":"0",
"bandwidth":"0","load-interval":9,"output-load":0,"input-load":0,"reliability":255},
"if-index":28,"is-intf-logical":true,"bandwidth64-bit":"0","max-bandwidth64-bit":"0"}}],
"collection_end_time":"1657492008549"}
--------
 Sub_id 200000001, flag 8, len 0
 ```
Now, let's try to _start_ from an openconfig model.
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

RP/0/RP0/CPU0:ansible-iosxr#show telemetry internal json openconfig-interfaces:interfaces/interface[name='Bundle-*']/state/counters
Sun Jul 10 22:43:59.255 UTC
{
  "encoding_path": "openconfig-interfaces:interfaces/interface/state",
  "subscription_id_str": "app_TEST_200000001",
  "collection_start_time": "1657493039807",
  "msg_timestamp": "1657493039813",
  "collection_end_time": "1657493039813",
  "node_id_str": "ansible-iosxr",
  "data_json": [
    {
      "keys": [
        {
          "name": "Bundle-Ether10"
        }
      ],
      "timestamp": "1657493039812",
      "content": {
        "name": "Bundle-Ether10",
        "type": "iana-if-type:ieee8023adLag",
        "oper-status": "DOWN",
        "enabled": true,
        "admin-status": "UP",
        "logical": true,
        "mtu": 1514,
        "ifindex": 28,
        "last-change": "0",
        "loopback-mode": false,
        "counters": {
          "carrier-transitions": "0"
        }
      }
    }
  ],
  "collection_id": "70"
},

```
That is all! Keep a note on the old commands that exists:
- **schema-describe** _"show command"_
- **run mdt_get_gather_paths** _\<yang model\>_
- **run mdt_exec** -s _\<xpath\>_ -c _\<sample interval in msec\>_

And the new one:
```
RP/0/RP0/CPU0:ansible-iosxr#show telemetry internal ?
  json   Display yang sensor paths data in json format
  xpath  Display yang sensor paths
```

Find out more on [xrdocs.io](https://xrdocs.io/), in the [telemetry tutorials](https://xrdocs.io/telemetry/tutorials/)

<p align="right">...till next time...<em>have fun!</em></p>

---

> Author:    
> URL: https://net4fungr.github.io/posts/xr-get-xpath/  

