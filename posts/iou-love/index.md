# For Those About to LAB...⚡

---
## Intro
Cisco IOL, aka IOU, and I go back a long way. Back in the day, when I decided to sit for the CCIE R&S v4 exam, there weren't many options to get hands on on the cli other than having access to real devices or using dynamips and GNS3 for simulating routers and switches, but with limited feature support, especially on the S side. 

Hence, since I have also been known as a big time pack rat, I decided to go for a real LAB. So, after spending nearly over $6k, I managed to build a real home lab with all the quirks. Terminal server, AUI converters , x-over and serial cables, remote managed PSUs, I remember being so happy! 

The joy went on for a couple of months, while I was setting up the scenarios, practicing the theory, re-configuring and starting over. Then one day, as I was googling for something, I bumped to some news that Cisco IOS-on-Unix has been leaked to the public and people were already using it to build virtual labs. Then an IOS-on-Linux version was also leaked and you can imagine how stupid I felt after this.

I, of course, ended up in using it and even got a refurb SPARCstation to run IOU in the interim before I could get my hands on a _stable_ IOL version without major issues. Anyway, this was just to give you the context of my history with IOL. I never sat for the lab in the end, but that's another story. 

So, imagine my excitement when the recent news of IOL support in [containerlab](https://containerlab.dev/rn/0.58/#cisco-iol) and [netlab](https://netlab.tools/release/1.9/#release-1-9-2) reached my eyes. It brought back so many reminisces, that I had to write something about it. Containerlab and netlab have always been in my back-blog, and I wanted to post about them, but I feel that the community is doing such a great job on them, whilst in this case I felt that the time is right for me as well.

As a bottom line here, IOL has always been the preferred choice due to its low demand on resources for the supported and relevant use cases, and the fact that it can now be supported in containerised topologies increases its network automation friendliness (NAFness :)) level, not too much though, since it is lacking some features as we will see later on.


## Use Case Brief
Everything starts with a use case, the intent! In my case, I want to spin up topologies and test different things in Kentik. The idea came from the [srl-telemetry-lab](https://github.com/srl-labs/srl-telemetry-lab), so we will be following the same approach but for Kentik related use cases. Hence,

- Dynamic topology that is sending netflow to Kentik via the kproxy agent
- Traffic simulation using iperf3 on the devices
- Kentik Synthetic agents attached to the topology performing tests
- Devices registered in Kentik NMS for monitoring

### Why containerlab?
- Dynamic topology: support CRUDs on the infrastructure
- IaC model support: everything defined in structured format
- Integrates well with netlab as a provider
- Minimal effort on the above / more focus on the use cases

### Why netlab?
- Automatic provisioning of underlay connectivity details and protocols
- Flexibility in adding custom templates and using custom playbooks based on a common ansible inventory file
- Good integration with containerlab
- Minimal effort on the above / more focus on the use cases

I think netlab is the perfect example of _Automating the Boring Stuff_. I never counted the times or will ever forget that I had to type those commands :smile: :
{{< admonition quote "Boring Stuff" >}}conf t ⏎ no ip do lo ⏎ line con 0 ⏎ logg syn ⏎ exec-t 0 ⏎ ^Z wr ⏎{{< /admonition >}}
### Why IOL?
- Demand on resources is very low
- Fit my use case since netflow export is supported
- No licensing limits on traffic volumes
- Seems IOL reports interface errors when traffic is pushed. A bug or a feature, don't care at the moment since it has always been a burden to fire up synthetic errors on interface counters.

### Things Covered
Now that we have picked up the correct tools for the job, let's see what we are going to cover so you can assess if this is still interesting enough to carry on reading.
- Using _netlab_ to provision a lab by using _containerlab_ for spinning up the nodes
- Using IOL for the network device type
- Using various containers to integrate with the topology as the linux device type
- Using _iperf3_ for generating traffic load on the topology
- Using OSPF, BGP, MPLS and VRF modules in _netlab_
- Using jinja templates to provision additional commands to the nodes either ad-hoc or during lab bring-up.
- Defining custom variables in the topology so we can use them later on either in the templates or in _ansible_ plays.
- We will be using _Windows Subsystem for Linux_ (WSL) for this use case.

So by using all the above we can deploy a topology like the one depicted in the following section, register the devices in Kentik, produce traffic and explore how to visualise, monitor, and run synthetic tests on it via Kentik. And all this by using automated tasks on the way.
### Topology Walk-through
{{< image src="topology.png" caption="LAB Topology" >}}

As you see, the topology is rather simple. We have four core devices (rcX) running an MPLS-LDP backbone and offering L3VPN services over MP-BGP to four CE devices (ceX). The PC nodes are used to generate traffic and the _ksynth_ nodes are Kentik private synthetics agents. As you may have guessed, we have two VPNs, <strong style="color: red;">_red_</strong> and <strong style="color: blue;">_blue_</strong>.

Network devices are IOL containers and PC's are based on the [network-multitool](https://github.com/srl-labs/network-multitool/pkgs/container/network-multitool) container image. Of course, we also have additional containers running and I like to call them service containers, since they are there to interact with the topology and report data back to Kentik, realising our use case.

The basic idea behind connectivity in _netlab/containerlab_ is that there is a _management_ docker bridge network that all nodes connect. Each node connects to the management network, usually by its first interface, and _netlab_ uses this to provision commands to it. All other node links are formed based on the desired configuration by bridging the relevant node interfaces.

Hence, the service containers, do not have to connect in-line to the topology and all communications go via the management network. But, let's see them one by one:
- **kproxy**: Kentik agent that listens to netflow from the devices and reports to Kentik. This agent also polls devices for SNMP metrics and metadata. All communications are going via the management network, from/to the devices in the isolated management VRF.  In addition, since this is a container attached to a docker network inside the host machine, it has access to the Internet by default, so it is able to go out to Kentik and report the data.
- **kbgp**: Kentik agent that tunnels bgp sessions from the devices all the way up to Kentik. This agent actually needs an inline connection so all other nodes can form the session. In our case, it is connected to **rc1** so all others can reach it. Communication with Kentik is done via the container's first interface that belongs to the management network, the same way as **kproxy** does.
- **kagent**: Kentik's Universal Agent that is part of the Kentik NMS product and is polling the devices for SNMP data and reporting it into the NMS part. Here, I have chosen to deploy this as a standard container on the host machine (WSL) and it is not included in the topology. Thus, _netlab_ is not aware of it at all, but still **kagent** can communicate with the devices via the management network since they are part of the same host, just in a different docker bridge network. So communication is possible since this agent is only polling the devices via their management interfaces and there is no need to expose anything (or should I say ingress path) from its side.

We will expand more on the connectivity details as we build the topology further on, but for now, the three basic things to ask yourself regarding how to run your service containers are:
- Do they need to be _controlled_ somehow via _netlab_?
- Does _netlab_ need to know any detail about them?
- Are your devices capable to communicate with them via their management VRF for their purpose?

## Setting Things Up

In this section we are going to focus on how to set things up in WSL. We will start by building the IOL containers for our use case and then see a typical installation of _netlab_.

### Building the IOL containers
IOL containers are supported in _containerlab_ via their [_vrnetlab_](https://containerlab.dev/manual/vrnetlab/#vrnetlab) fork. The current IOL [images](https://developer.cisco.com/docs/modeling-labs/iol/) are those included with the Cisco CML image reference collection (refplat), so you have to get hold of them and copy them to the relevant build directory in _vrnetlab_ in order to build them. Here are the steps:

**\>\>\>** Clone the repo:
```bash
(wsl)<<· git clone https://github.com/hellt/vrnetlab
Cloning into 'vrnetlab'...
remote: Enumerating objects: 5363, done.
remote: Counting objects: 100% (2011/2011), done.
remote: Compressing objects: 100% (660/660), done.
remote: Total 5363 (delta 1542), reused 1649 (delta 1348), pack-reused 3352 (from 1)
Receiving objects: 100% (5363/5363), 2.27 MiB | 664.00 KiB/s, done.
Resolving deltas: 100% (3245/3245), done.
```

**\>\>\>** Copy the images to the appropriate folder and rename them according to the README. I chose to make links to them instead:
```bash
(wsl)<<· cd vrnetlab/cisco/iol/
(wsl)<<· lll
total 516920
-rw-r--r-- 1       289  Makefile
-rw-r--r-- 1      1721  README.md
lrwxrwxrwx 1        35  cisco_iol-17.12.1.bin -> x86_64_crb_linux-adventerprisek9-ms
lrwxrwxrwx 1        38  cisco_iol-L2-17.12.1.bin -> x86_64_crb_linux_l2-adventerprisek9-ms
drwxr-xr-x 2      4096  docker
-rwxr-xr-x 1 288947184  x86_64_crb_linux-adventerprisek9-ms
-rwxr-xr-x 1 240355720  x86_64_crb_linux_l2-adventerprisek9-ms
```

**\>\>\>** Build with `make docker-image` and check in docker. You should end up having the two IOL images in the registry. One for the _router_ and one for the _switch_. 

```bash
(wsl)<<· make docker-image
< build output >

(wsl)<<· docker images vrnetlab/cisco_iol*
REPOSITORY           TAG          IMAGE ID       CREATED              SIZE
vrnetlab/cisco_iol   L2-17.12.1   15d363218573   About a minute ago   607MB
vrnetlab/cisco_iol   17.12.1      1d44f7fa6252   About a minute ago   704MB
```

**\>\>\>** You can test with the following command to see if they are _booting_ 
```bash
(wsl)<<· docker run -it --rm -e IOL_PID=1 \
	--mount type=bind,source=/dev/null,target=/iol/NETMAP vrnetlab/cisco_iol:17.12.1

Launching IOL with PID 1
Failed to send flush request: Operation not permitted
Flushed eth0 addresses
/entrypoint.sh: line 14: /usr/bin/iouyap: Operation not permitted
/entrypoint.sh: line 14: /usr/bin/iouyap: Success
IOS On Unix - Cisco Systems confidential, internal use only

 IOURC: Could not open iourc file
Warning: configuration file (config.txt) does not exist

Warning: Abnormal ciscoversion string, please notify the IOU team
with the name of this branch
Warning: we parsed - NULL

              Restricted Rights Legend

Use, duplication, or disclosure by the Government is
subject to restrictions as set forth in subparagraph
(c) of the Commercial Computer Software - Restricted
Rights clause at FAR sec. 52.227-19 and subparagraph
(c) (1) (ii) of the Rights in Technical Data and Computer
Software clause at DFARS sec. 252.227-7013.

           Cisco Systems, Inc.
           170 West Tasman Drive
           San Jose, California 95134-1706



Cisco IOS Software [Dublin], Linux Software (X86_64BI_LINUX-ADVENTERPRISEK9-M), Version 17.12.1, RELEASE SOFTWARE (fc5)
Technical Support: http://www.cisco.com/techsupport
Copyright (c) 1986-2023 by Cisco Systems, Inc.
Compiled Thu 27-Jul-23 22:33 by mcpre


PM unix notify udp ports APP_ID:0 DISABLE Port1:0 Port2:0
PM unix notify udp ports APP_ID:1 DISABLE Port1:0 Port2:0Linux Unix (i686) processor with 550115K bytes of memory.
Processor board ID 1
4 Ethernet interfaces
1024K bytes of NVRAM.

No startup-config, starting autoinstall/pnp/ztp...

Autoinstall will terminate if any input is detected on console

Autoinstall trying DHCPv4 on Ethernet0/0,Ethernet0/1,Ethernet0/2,Ethernet0/3

< snipped >
```

They are based on XE 17.12.1 release so they are more feature rich than the past IOL ones (IOS 15.x), they do **not** support any of the automation goodies as well as streaming telemetry, but they can push traffic without any licensing restriction.

### Installing Netlab in WSL
Now that we have our devices, let's go ahead and install _netlab_ in WSL. I am using the following versions and linux flavour:
```bash
(wsl)·>> wsl.exe -v
WSL version: 2.3.26.0
Kernel version: 5.15.167.4-1
WSLg version: 1.0.65
MSRDC version: 1.2.5620
Direct3D version: 1.611.1-81528511
DXCore version: 10.0.26100.1-240331-1435.ge-release
Windows version: 10.0.19045.5131

(wsl)<<· cat /etc/os-release
PRETTY_NAME="Ubuntu 22.04.5 LTS"
NAME="Ubuntu"
VERSION_ID="22.04"
VERSION="22.04.5 LTS (Jammy Jellyfish)"
VERSION_CODENAME=jammy
ID=ubuntu
ID_LIKE=debian
HOME_URL="https://www.ubuntu.com/"
SUPPORT_URL="https://help.ubuntu.com/"
BUG_REPORT_URL="https://bugs.launchpad.net/ubuntu/"
PRIVACY_POLICY_URL="https://www.ubuntu.com/legal/terms-and-policies/privacy-policy"
UBUNTU_CODENAME=jammy

```

**\>\>\>** I chose to install _netlab_ in a virtual env:
```bash
(wsl)<<· sudo apt install python-is-python3 python3-pip python3-venv
< snipped >

(wsl)<<· mkdir -p netlab/iol
(wsl)<<· cd netlab/iol
(wsl)<<· python -m venv .venv
(wsl)<<· source .venv/bin/activate

```

**\>\>\>** Install _netlab_ via pip and then all dependencies:
```bash
(wsl)<<· pip install networklab
< snipped >

(wsl)<<· netlab install ubuntu ansible containerlab
< snipped >
```

**\>\>\>** Open another terminal to cause re-login and bring up the test topology to verify everything is set up correctly:
```
(wsl)<<· cd netlab/iol
(wsl)<<· source .venv/bin/activate
(wsl)<<· netlab test clab
< snipped >
```
_Netalab_ will provision a 3 node topology based on _frr_ and test if everything is working as expected. Finally it will cleanup after itself.

## Topology Definition

Let's now start the fun part by exploring how to define our LAB so _netlab_ can spin it up and provision it the way we want it.  _Netlab_ expects us to define everything in a single topology definition file, by default `topology.yml`.  We are going to build the base topology that includes just the routers and the PC's, and then move on with adding the service containers.

### Building the Base Topology - Step-by-step
The first thing to do in the topology file is to declare which virtualisation provider we are going to be using. For our case this is `clab` and here is how to check what others are supported along with their status in the current installation:
```bash
(wsl)<<· netlab show providers
Supported virtualization providers

┏━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━┓
┃ provider   ┃ description              ┃ status ┃
┡━━━━━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━┩
│ clab       │ containerlab with Docker │ OK     │
│ external   │ External devices         │ OK     │
│ libvirt    │ Vagrant with libvirt/KVM │ N/A    │
│ virtualbox │ Vagrant with Virtualbox  │ N/A    │
└────────────┴──────────────────────────┴────────┘
```
The minimum sections that _netlab_ expects to find in the topology file is the `provider`, the `nodes` and the `links`. And the minimum attributes that it needs to know about a node before provisioning it is the device type we want to use. Here are the supported device types:
```bash
(wsl)<<· netlab show devices
Virtual network devices supported by netlab

┏━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ device        ┃ description                                   ┃
┡━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┩
│ arubacx       │ ArubaOS-CX                                    │
│ asav          │ Cisco ASAv                                    │
│ cat8000v      │ Cisco CSR 1000v                               │
│ csr           │ Cisco CSR 1000v                               │
│ cumulus       │ Cumulus VX 4.x or 5.x configured without NVUE │
│ cumulus_nvue  │ Cumulus VX 5.x configured with NVUE           │
│ dellos10      │ Dell OS10                                     │
│ eos           │ Arista vEOS VM or cEOS container              │
│ fortios       │ Fortinet FortiOS firewall                     │
│ frr           │ FRR container                                 │
│ iol           │ Cisco IOL                                     │
│ ioll2         │ IOSv L2 image                                 │
│ iosv          │ Cisco IOSv                                    │
│ iosvl2        │ IOSv L2 image                                 │
│ iosxr         │ Cisco IOS XRv                                 │
│ linux         │ Generic Linux host                            │
│ nxos          │ Cisco Nexus 9300v                             │
│ routeros      │ Mikrotik RouterOS version 6                   │
│ routeros7     │ Mikrotik RouterOS version 7                   │
│ sonic         │ Sonic VM                                      │
│ srlinux       │ Nokia SR Linux container                      │
│ sros          │ Nokia SR OS container                         │
│ vjunos-switch │ vJunos Switch                                 │
│ vmx           │ Juniper vMX container                         │
│ vptx          │ Juniper vPTX                                  │
│ vsrx          │ Juniper vSRX 3.0                              │
│ vyos          │ VyOS VM/container                             │
└───────────────┴───────────────────────────────────────────────┘

Networking daemons supported by netlab

┏━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ daemon  ┃ description                  ┃
┡━━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┩
│ bird    │ BIRD Internet Routing Daemon │
│ dnsmasq │ BIRD Internet Routing Daemon │
└─────────┴──────────────────────────────┘
```
So `iol` for the routers and `linux` for the PC's and as you may have guessed _netlab_ has a `defaults` _dictionary_ that is pre-populated for us that we can of course override with custom values. For example, let's see which images will be used if we specify device type as `iol` and `linux` by using the `netlab show` command:
```bash
(wsl)<<· netlab show images -d iol
iol image names by virtualization provider

┏━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━┳━━━━━━━━━━━━┓
┃ device ┃ clab                        ┃ libvirt ┃ virtualbox ┃
┡━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━╇━━━━━━━━━━━━┩
│ iol    │ vrnetlab/cisco_iol:17.12.01 │         │            │
└────────┴─────────────────────────────┴─────────┴────────────┘

(wsl)<<· netlab show images -d linux
linux image names by virtualization provider

┏━━━━━━━━┳━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━┓
┃ device ┃ clab              ┃ libvirt            ┃ virtualbox         ┃
┡━━━━━━━━╇━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━┩
│ linux  │ python:3.9-alpine │ generic/ubuntu2004 │ generic/ubuntu2004 │
└────────┴───────────────────┴────────────────────┴────────────────────┘

```
So these container images will be picked up by default if we specify the respective device type in the topology. Of course, we want to override those since our images are different, and here is how we can do this in the topology file by utilising a separate `defaults` section prior to defining our `nodes` and their interconnection `links`:

```yaml
provider: clab
defaults:
  device: iol
  devices.iol.clab.image: vrnetlab/cisco_iol:17.12.1
  devices.linux.clab.image: ghcr.io/srl-labs/network-multitool

nodes:
  rc1:
    device: iol
  rc2:
    device: iol
  rc3:
    device: iol
  rc4:
    device: iol
  pc1:
    device: linux
  pc2:
    device: linux
  pc3:
    device: linux
  pc4:
    device: linux

links:
  - rc1-rc2
  - rc1-rc3
  - rc2-rc4
  - rc3-rc4
  - rc1-pc1
  - rc2-pc2
  - rc3-pc3
  - rc4-pc4
```

Now, let's bring up the topology to see the real power of _netlab_. To start the lab we can use the `netlab up` command and after some scripts are executed and some ansible plays, everything is up and running. We can check this with `netlab status` command:
```bash
(wsl)<<· netlab status

┏━━━━━━┳━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━┳━━━━━━━━━━┳━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━┓
┃ node ┃ device ┃ image                          ┃ mgmt IPv4       ┃ connection  ┃ provider ┃ VM/container ┃ status       ┃
┡━━━━━━╇━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━╇━━━━━━━━━━╇━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━┩
│ pc1  │ linux  │ ghcr.io/srl-labs/network-mult… │ 192.168.121.105 │ docker      │ clab     │ clab-iol-pc1 │ Up 2 minutes │
├──────┼────────┼────────────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼──────────────┤
│ pc2  │ linux  │ ghcr.io/srl-labs/network-mult… │ 192.168.121.106 │ docker      │ clab     │ clab-iol-pc2 │ Up 2 minutes │
├──────┼────────┼────────────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼──────────────┤
│ pc3  │ linux  │ ghcr.io/srl-labs/network-mult… │ 192.168.121.107 │ docker      │ clab     │ clab-iol-pc3 │ Up 2 minutes │
├──────┼────────┼────────────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼──────────────┤
│ pc4  │ linux  │ ghcr.io/srl-labs/network-mult… │ 192.168.121.108 │ docker      │ clab     │ clab-iol-pc4 │ Up 2 minutes │
├──────┼────────┼────────────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼──────────────┤
│ rc1  │ iol    │ vrnetlab/cisco_iol:17.12.1     │ 192.168.121.101 │ network_cli │ clab     │ clab-iol-rc1 │ Up 2 minutes │
├──────┼────────┼────────────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼──────────────┤
│ rc2  │ iol    │ vrnetlab/cisco_iol:17.12.1     │ 192.168.121.102 │ network_cli │ clab     │ clab-iol-rc2 │ Up 2 minutes │
├──────┼────────┼────────────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼──────────────┤
│ rc3  │ iol    │ vrnetlab/cisco_iol:17.12.1     │ 192.168.121.103 │ network_cli │ clab     │ clab-iol-rc3 │ Up 2 minutes │
├──────┼────────┼────────────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼──────────────┤
│ rc4  │ iol    │ vrnetlab/cisco_iol:17.12.1     │ 192.168.121.104 │ network_cli │ clab     │ clab-iol-rc4 │ Up 2 minutes │
└──────┴────────┴────────────────────────────────┴─────────────────┴─────────────┴──────────┴──────────────┴──────────────┘
```

Seems everything is up and running, but how is this different than just bringing up the topology with _containerlab_? Well, _netlab_ goes one step further and configures the devices with basic ip connectivity and also with any other protocol that is supported as we will see later on. We can check on a device for example:
```bash
(wsl)<<· netlab exec rc1 show ip int br
Connecting to clab-iol-rc1 using SSH port 22, executing show ip int br



Interface              IP-Address      OK? Method Status                Protocol
Ethernet0/0            192.168.121.101 YES TFTP   up                    up
Ethernet0/1            10.1.0.1        YES manual up                    up
Ethernet0/2            10.1.0.5        YES manual up                    up
Ethernet0/3            172.16.0.1      YES manual up                    up
Loopback0              10.0.0.1        YES manual up                    up      Connection to clab-iol-rc1 closed by remote host.

```
Or on a PC:
```bash
(wsl)<<· netlab exec pc1 ip -c -br a
Connecting to container clab-iol-pc1, executing ip -c -br a
lo               UNKNOWN        127.0.0.1/8 ::1/128
eth0@if1052      UP             192.168.121.105/24 fe80::42:c0ff:fea8:7969/64
eth1@if1065      UP             172.16.0.5/24 fe80::a8c1:abff:fe5d:19e2/64


(wsl)<<· netlab exec pc1 ip -c -br r
Connecting to container clab-iol-pc1, executing ip -c -br r
default via 192.168.121.1 dev eth0
10.0.0.0/24 via 172.16.0.1 dev eth1
10.1.0.0/16 via 172.16.0.1 dev eth1
10.2.0.0/24 via 172.16.0.1 dev eth1
172.16.0.0/24 dev eth1 proto kernel scope link src 172.16.0.5
172.16.0.0/16 via 172.16.0.1 dev eth1
192.168.121.0/24 dev eth0 proto kernel scope link src 192.168.121.105

```

So apart from bringing up the nodes, _netlab_ using its defaults dictionary and attributes, parsed the topology and provisioned IP addresses for every link and also configured the routing in linux to point to the blocks used in the topology via the containers' second interface attached to the router. In this way, we can define our topology and protocols and _netlab_ will take care of the commands needed to be provisioned and pushed to the nodes.

Let's see now the default addressing scheme:
```bash
(wsl)·>> netlab show defaults addressing

netlab default settings within the addressing subtree
=============================================================================

l2only: null
lan:
  ipv4: 172.16.0.0/16
loopback:
  ipv4: 10.0.0.0/24
mgmt:
  ipv4: 192.168.121.0/24
  mac: 08-4F-A9-00-00-00
  start: 100
p2p:
  ipv4: 10.1.0.0/16
router_id:
  ipv4: 10.0.0.0/24
  prefix: 32
vrf_loopback:
  ipv4: 10.2.0.0/24
  prefix: 32
```

As you see, for any p2p link the 10.1/16 block will be used, whereas for any lan, _netlab_ will use the 172.16/16 one. 10.0.0/24 is used for the loopbacks and 10.2.0/24 for any loopback that belongs in a vrf and, of course, you may modify these as per your liking.

Furthermore, in order to understand this behaviour a bit more, check on the directory structure to see the different directories and files created since we brought up the lab:
```bash
(wsl)<<· tree . -L 1
.
├── ansible.cfg          <- Ansible configuration file
├── clab-iol             <- clab related runtime directory
├── clab.yml             <- Respective clab topology file
├── clab_files           <- hosts files to mount at /etc/hosts for every linux container
├── group_vars           <- Ansible group_vars after merging the defaults and topology specific variables
├── host_vars            <- same for each host
├── hosts.yml            <- Ansible inventory file
├── netlab.lock          <- lock file when netlab is running
├── netlab.snapshot.yml  <- snapshot of the whole dictionary
└── topology.yml         <- Original topology file that we started with
```

So we ended up having a full blown ansible structure for this lab that _netlab_ is using to provision commands and, guess what, we can also use it with our own plays.

Two additional commands to help you in exploring the data structure and ansible variables available in the topology are `netlab inspect` and `ansible-inventory`.

```bash
(wsl)<<· netlab inspect --node rc1 loopback
ifindex: 0
ifname: Loopback0
ipv4: 10.0.0.1/32
neighbors: []
type: loopback
virtual_interface: true

(wsl)<<· ansible-inventory --host rc1 | jq .loopback
{
  "ifindex": 0,
  "ifname": "Loopback0",
  "ipv4": "10.0.0.1/32",
  "neighbors": [],
  "type": "loopback",
  "virtual_interface": true
}
```

OK, now that we got the hang of it, let's bring down the topology and cleanup our directory structure in order to complete the basic topology definition.
```bash
(wsl)<<· netlab down --cleanup
[SUCCESS] Read transformed lab topology from snapshot file netlab.snapshot.yml

┌──────────────────────────────────────────────────────────────────────────────────┐
│ CHECKING virtualization provider installation                                    │
└──────────────────────────────────────────────────────────────────────────────────┘
[SUCCESS] clab installed and working correctly

┌──────────────────────────────────────────────────────────────────────────────────┐
│ STOPPING clab nodes                                                              │
└──────────────────────────────────────────────────────────────────────────────────┘
INFO[0000] Parsing & checking topology file: clab.yml
INFO[0000] Parsing & checking topology file: clab.yml
WARN[0000] errors during iptables rules install: not available
INFO[0000] Destroying lab: iol
INFO[0001] Removed container: clab-iol-pc4
INFO[0001] Removed container: clab-iol-rc2
INFO[0002] Removed container: clab-iol-pc1
INFO[0002] Removed container: clab-iol-pc3
INFO[0002] Removed container: clab-iol-pc2
INFO[0002] Removed container: clab-iol-rc4
INFO[0002] Removed container: clab-iol-rc1
INFO[0002] Removed container: clab-iol-rc3
INFO[0002] Removing containerlab host entries from /etc/hosts file
INFO[0002] Removing ssh config for containerlab nodes
WARN[0003] errors during iptables rules removal: not available

┌──────────────────────────────────────────────────────────────────────────────────┐
│ CLEANUP configuration files                                                      │
└──────────────────────────────────────────────────────────────────────────────────┘
... removing clab.yml
... removing directory tree clab_files
... removing ansible.cfg
... removing hosts.yml
... removing directory tree group_vars
... removing directory tree host_vars
... removing netlab.snapshot.yml

(wsl)<<· tree .
.
└── topology.yml
```

### Base Topology - Complete
Here is the complete basic topology file with adding some extra quirks:
```yaml
provider: clab
defaults:
  device: iol
  devices.iol.clab.image: vrnetlab/cisco_iol:17.12.1
  devices.linux.clab.image: ghcr.io/srl-labs/network-multitool
  providers.clab.lab_prefix: ""
  groups._auto_create: True
  paths.append.custom.dirs: [ templates ]
  vrf.as: 65515
 
groups:
  core:
    members: [ rc1, rc2, rc3, rc4 ]
    module: [ ospf, bgp, mpls, vrf ]
    bgp.as: 65515
    mpls.vpn: [ ibgp ]
    vrf.loopback: true
    config: [ core_extras ]
  ces:
    members: [ ce1, ce2, ce3, ce4 ]
    module: [ bgp ]
  pcs:
    members: [ pc1, pc2, pc3, pc4, pc11, pc12, pc13, pc14 ]
    device: linux
    config: [ iperf3_server ]
    vars:
      IPERF3_TESTS: [
                { "src":"pc1", "dst": "pc4", "port": "5201" },
                { "src":"pc2", "dst": "pc1", "port": "5201" },
                { "src":"pc3", "dst": "pc2", "port": "5201" },
                { "src":"pc4", "dst": "pc3", "port": "5201" },
                { "src":"pc1", "dst": "pc3", "port": "5202" },
                { "src":"pc2", "dst": "pc4", "port": "5202" },
                { "src":"pc11", "dst": "pc14", "port": "5201" },
                { "src":"pc14", "dst": "pc11", "port": "5201" },
                { "src":"pc12", "dst": "pc13", "port": "5201" },
                { "src":"pc13", "dst": "pc12", "port": "5201" },
      ]        
vrfs:
  blue:
    rd: '65515:101'
nodes:
  rc1:
  rc2:
    vrfs:
      red:
       rd: "10.0.0.2:102"
       import: '65515:102'
       export: '65515:102'
  rc3:
    vrfs:
      red:
       rd: "10.0.0.3:102"
       import: '65515:102'
       export: '65515:102'
  rc4:
  ce1:
    id: 11
    bgp.as: 65101
  ce2:
    id: 12
    bgp.as: 65201
  ce3:
    id: 13
    bgp.as: 65202
  ce4:
    id: 14
    bgp.as: 65102
  
links:
  - rc1-rc2
  - rc1-rc3
  - rc2-rc4
  - rc3-rc4
  - rc1-pc1
  - rc2-pc2
  - rc3-pc3
  - rc4-pc4
  - rc1: { vrf: blue }
    ce1:
  - rc2: { vrf: red }
    ce2:
  - rc3: { vrf: red }
    ce3:
  - rc4: { vrf: blue }
    ce4:
  - ce1-pc11
  - ce2-pc12
  - ce3-pc13
  - ce4-pc14

```
OK, we have now added some things or two here that we will expand on. 

- First of all, we have used the `groups` section to group our nodes and apply attributes to them rather than having to replicate them for each one in the `nodes` section.
- The `groups._auto_create: True` allows for not having to define each node under the node section and create them ad-hoc from the members list under the `groups`, but this does not guarantee the `id` each node will have. Since the addressing considers those `id's` and the order of specifying them under the `nodes` section matters, we can have a mix of those two ways to auto-define nodes and also pin some to specific `ids`. So rc's get 1 to 4, ce's 11 to 14 and for pc's we don't care.
- The desired protocols to be enabled on each node is done via the `module` structure.
- We have used the `defaults.providers.clab.lab_prefix: ""` in order for the containers not to include the default `clab-<directoty>` prefix in their name.
- We are using jinja templates to provision additional commands to the nodes during start up and we define them in the `config` section of our `groups` definition. I have all my templates under a `templates` folder in the directory structure, so we need a way to let _netlab_ _know_ where to search for them. This is done by the `defaults.paths.append.custom.dirs: [ templates ]` key.
- For core devices, we are enabling dns server on them via the `core_extras` template
```jinja
(wsl)<<· cat templates/core_extras.j2
{# Enable DNS server in both GRT and mgmt vrf #}
!
ip dns server
ip dns view vrf clab-mgmt
!
```
- For the PCs, we want them to run _iperf3_ as server and also have the ability to start and stop traffic generation after the lab is up. So here, we have defined all the tests in a structure as a variable, that we can decompose in jinja to get either the server ports that need to be listening on, or the actual client tests to be performed.  The server template is executed during bring up and for each PC we are looking to listen to all target ports: 
```jinja
{% for test in IPERF3_TESTS %}{% if test.dst == hostname %}
iperf3 -s -p {{ test.port }} -D
{% endif %}{% endfor %}```
```
- For the client tests we use the `netlab config` command to render the template ad-hoc and run or stop the tests after the topology is brought up:
```jinja
{% if ACTION is not defined or ACTION not in ['run','stop'] %}
 {{_|mandatory("ACTION is mandatoy - run or stop")}}
{% elif ACTION == "run" %}
{% for test in IPERF3_TESTS %}{% if test.src == hostname %}
iperf3 -c {{ test.dst }} -p {{ test.port}} -t0 -P 5 -b 5M  > iperf-{{ test.dst }}.log &
{% endif %}{% endfor %}
{% elif ACTION == "stop" %}
ps aux | grep 'iperf3 -c' | grep -v grep | awk '{print $2}' | xargs kill -9
{% endif %}
```


```bash
ANSIBLE_NOCOWS=1 netlab config iperf3_clients -l pc1 -e ACTION=run --check -v
< snipped > 

TASK [Process template /home/netlab/iol/templates/iperf3_clients.j2 for pc1] **********
ok: [pc1] =>
  msg: |-
    /home/netlab/iol/templates/iperf3_clients.j2 configuration for pc1
    =========================================
    iperf3 -c pc4 -p 5201 -t0 -P 5 -b 5M  > iperf-pc4.log &
    iperf3 -c pc3 -p 5202 -t0 -P 5 -b 5M  > iperf-pc3.log &

< snipped > 
```
We could be more granular here on the parallel streams, time, bandwidth or whatever else is required.
- Lastly, for the `vrf` module, we wanted one VPN to use IPv4:Number format so we had to manually specify the RDs/RTs under the nodes.

Let's issue a `netlab create` first to check if we are syntactically correct or we missed some logic,  and then bring it up.
```bash
(wsl)<<· netlab create
[CREATED] provider configuration file: clab.yml
[MAPPED]  clab_files/pc1/hosts to pc1:/etc/hosts (from templates/provider/clab/linux/hosts.j2)
[MAPPED]  clab_files/pc2/hosts to pc2:/etc/hosts (from templates/provider/clab/linux/hosts.j2)
[MAPPED]  clab_files/pc3/hosts to pc3:/etc/hosts (from templates/provider/clab/linux/hosts.j2)
[MAPPED]  clab_files/pc4/hosts to pc4:/etc/hosts (from templates/provider/clab/linux/hosts.j2)
[MAPPED]  clab_files/pc11/hosts to pc11:/etc/hosts (from templates/provider/clab/linux/hosts.j2)
[MAPPED]  clab_files/pc12/hosts to pc12:/etc/hosts (from templates/provider/clab/linux/hosts.j2)
[MAPPED]  clab_files/pc13/hosts to pc13:/etc/hosts (from templates/provider/clab/linux/hosts.j2)
[MAPPED]  clab_files/pc14/hosts to pc14:/etc/hosts (from templates/provider/clab/linux/hosts.j2)
[CREATED] transformed topology dump in YAML format in netlab.snapshot.yml
[GROUPS]  group_vars for all
[GROUPS]  group_vars for modules
[GROUPS]  group_vars for custom_configs
[GROUPS]  group_vars for iol
[HOSTS]   host_vars for rc1
[HOSTS]   host_vars for rc2
[HOSTS]   host_vars for rc3
[HOSTS]   host_vars for rc4
[HOSTS]   host_vars for ce1
[HOSTS]   host_vars for ce2
[HOSTS]   host_vars for ce3
[HOSTS]   host_vars for ce4
[GROUPS]  group_vars for linux
[HOSTS]   host_vars for pc1
[HOSTS]   host_vars for pc2
[HOSTS]   host_vars for pc3
[HOSTS]   host_vars for pc4
[HOSTS]   host_vars for pc11
[HOSTS]   host_vars for pc12
[HOSTS]   host_vars for pc13
[HOSTS]   host_vars for pc14
[GROUPS]  group_vars for pcs
[CREATED] minimized Ansible inventory hosts.yml
[CREATED] Ansible configuration file: ansible.cfg
```

```bash
(wsl)<<· ANSIBLE_NOCOWS=1 netlab up
< snipped >

PLAY RECAP ****************************************************************************************************************
ce1                        : ok=25   changed=4    unreachable=0    failed=0    skipped=14   rescued=0    ignored=0
ce2                        : ok=24   changed=3    unreachable=0    failed=0    skipped=14   rescued=0    ignored=0
ce3                        : ok=24   changed=3    unreachable=0    failed=0    skipped=14   rescued=0    ignored=0
ce4                        : ok=24   changed=3    unreachable=0    failed=0    skipped=14   rescued=0    ignored=0
pc1                        : ok=19   changed=5    unreachable=0    failed=0    skipped=5    rescued=0    ignored=0
pc11                       : ok=19   changed=5    unreachable=0    failed=0    skipped=5    rescued=0    ignored=0
pc12                       : ok=19   changed=5    unreachable=0    failed=0    skipped=5    rescued=0    ignored=0
pc13                       : ok=19   changed=5    unreachable=0    failed=0    skipped=5    rescued=0    ignored=0
pc14                       : ok=19   changed=5    unreachable=0    failed=0    skipped=5    rescued=0    ignored=0
pc2                        : ok=19   changed=5    unreachable=0    failed=0    skipped=5    rescued=0    ignored=0
pc3                        : ok=19   changed=5    unreachable=0    failed=0    skipped=5    rescued=0    ignored=0
pc4                        : ok=19   changed=5    unreachable=0    failed=0    skipped=5    rescued=0    ignored=0
rc1                        : ok=42   changed=7    unreachable=0    failed=0    skipped=8    rescued=0    ignored=0
rc2                        : ok=42   changed=7    unreachable=0    failed=0    skipped=8    rescued=0    ignored=0
rc3                        : ok=42   changed=7    unreachable=0    failed=0    skipped=8    rescued=0    ignored=0
rc4                        : ok=42   changed=7    unreachable=0    failed=0    skipped=8    rescued=0    ignored=0

[SUCCESS] Lab devices configured

(wsl)<<· netlab status


┏━━━━━━┳━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━┳━━━━━━━━━━┳━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━┓
┃ node ┃ device ┃ image                     ┃ mgmt IPv4       ┃ connection  ┃ provider ┃ VM/container ┃ status            ┃
┡━━━━━━╇━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━╇━━━━━━━━━━╇━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━━━━━┩
│ ce1  │ iol    │ vrnetlab/cisco_iol:17.12… │ 192.168.121.111 │ network_cli │ clab     │ ce1          │ Up About a minute │
├──────┼────────┼───────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼───────────────────┤
│ ce2  │ iol    │ vrnetlab/cisco_iol:17.12… │ 192.168.121.112 │ network_cli │ clab     │ ce2          │ Up About a minute │
├──────┼────────┼───────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼───────────────────┤
│ ce3  │ iol    │ vrnetlab/cisco_iol:17.12… │ 192.168.121.113 │ network_cli │ clab     │ ce3          │ Up About a minute │
├──────┼────────┼───────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼───────────────────┤
│ ce4  │ iol    │ vrnetlab/cisco_iol:17.12… │ 192.168.121.114 │ network_cli │ clab     │ ce4          │ Up About a minute │
├──────┼────────┼───────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼───────────────────┤
│ pc1  │ linux  │ ghcr.io/srl-labs/network… │ 192.168.121.105 │ docker      │ clab     │ pc1          │ Up About a minute │
├──────┼────────┼───────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼───────────────────┤
│ pc11 │ linux  │ ghcr.io/srl-labs/network… │ 192.168.121.109 │ docker      │ clab     │ pc11         │ Up About a minute │
├──────┼────────┼───────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼───────────────────┤
│ pc12 │ linux  │ ghcr.io/srl-labs/network… │ 192.168.121.110 │ docker      │ clab     │ pc12         │ Up About a minute │
├──────┼────────┼───────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼───────────────────┤
│ pc13 │ linux  │ ghcr.io/srl-labs/network… │ 192.168.121.115 │ docker      │ clab     │ pc13         │ Up About a minute │
├──────┼────────┼───────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼───────────────────┤
│ pc14 │ linux  │ ghcr.io/srl-labs/network… │ 192.168.121.116 │ docker      │ clab     │ pc14         │ Up About a minute │
├──────┼────────┼───────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼───────────────────┤
│ pc2  │ linux  │ ghcr.io/srl-labs/network… │ 192.168.121.106 │ docker      │ clab     │ pc2          │ Up About a minute │
├──────┼────────┼───────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼───────────────────┤
│ pc3  │ linux  │ ghcr.io/srl-labs/network… │ 192.168.121.107 │ docker      │ clab     │ pc3          │ Up About a minute │
├──────┼────────┼───────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼───────────────────┤
│ pc4  │ linux  │ ghcr.io/srl-labs/network… │ 192.168.121.108 │ docker      │ clab     │ pc4          │ Up About a minute │
├──────┼────────┼───────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼───────────────────┤
│ rc1  │ iol    │ vrnetlab/cisco_iol:17.12… │ 192.168.121.101 │ network_cli │ clab     │ rc1          │ Up About a minute │
├──────┼────────┼───────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼───────────────────┤
│ rc2  │ iol    │ vrnetlab/cisco_iol:17.12… │ 192.168.121.102 │ network_cli │ clab     │ rc2          │ Up About a minute │
├──────┼────────┼───────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼───────────────────┤
│ rc3  │ iol    │ vrnetlab/cisco_iol:17.12… │ 192.168.121.103 │ network_cli │ clab     │ rc3          │ Up About a minute │
├──────┼────────┼───────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼───────────────────┤
│ rc4  │ iol    │ vrnetlab/cisco_iol:17.12… │ 192.168.121.104 │ network_cli │ clab     │ rc4          │ Up About a minute │
└──────┴────────┴───────────────────────────┴─────────────────┴─────────────┴──────────┴──────────────┴───────────────────┘

```
All our nodes are up and as you can see from their management IP, their `id's` are following either the order of their definition in the topology file or the `id` value defined for them.

### Service Containers
Let's add now our additional containers based on our use case. We are going to be defining them in the topology as we did for our `PC's`, but here we also need to pass some `env` variables to them in order for _containerlab_ to bring them up properly. Some of these variables have common values for  all but some have specific one's. Hence, we are going to use the hierarchy to define them accordingly.

Here is how the relevant `groups` section looks like in the topology:
```yaml
groups:
  ksynth:
    members: [ ksynth1, ksynth2, ksynth3, ksynth4 ]
    device: linux
    clab:
      image: kentik/ksynth-agent:latest
  kentik:
    members: [ kproxy, kbgp, ksynth1, ksynth2, ksynth3, ksynth4 ]
    clab:
      env:
        KENTIK_COMPANY: < Kentik Company ID >
        KENTIK_REGION: EU
        KENTIK_API_TOKEN: < Kentik User Token >
        KENTIK_API_EMAIL: < Kentik User Email >
```
Here we have used one group to define the **ksynth** agents that are based on the relevant image, and also, used the **kentik** group to define the common variables that all the service containers need in order to communicate with Kentik.

Now, let's look at the `nodes` section:
```yaml
nodes:
  kproxy:
    device: linux
    clab:
      image: kentik/kproxy:latest
      cmd: >-
           -api_email=< Kentik kproxy agent email address >
           -region=EU
           -healthcheck=0.0.0.0
           -dns internal:192.168.121.101:53
  ksynth1:
    clab.binds:
      - mounts/ksynth1:/var/lib/ksynth-agent
  ksynth2:
    clab.binds:
      - mounts/ksynth2:/var/lib/ksynth-agent
  ksynth3:
    clab.binds:
      - mounts/ksynth3:/var/lib/ksynth-agent
  ksynth4:
    clab.binds:
      - mounts/ksynth4:/var/lib/ksynth-agent
  kbgp:
    device: linux
    clab:
      image: kentik/kbgp:latest
      env:
        KENTIK_REGION: fra1
```
Here we can observe the following:
- For **kproxy**:  We define the image and pass along the command line to be run on the container. All other `env` variables defined in the `groups` section are going to be available to the container as well. Unfortunately, I could not find a way to dynamically pass variables in the `clab.cmd` 
- For **ksynth**:  Since we want the agents to persist, we have to preserve the relevant directory across deployments, so we bind mount a local directory path for every instance. The relevant directories have to exist in our directory structure.
- For **kbgp**: We specify the image and re-define the region variable to override the one defined in the `groups` section since only **kbgp** needs it to be like that.

We also create the additional connections in our `links` section:
```yaml
links:
  - rc1-ksynth1
  - rc2-ksynth2
  - rc3-ksynth3
  - rc4-ksynth4
  - rc1-kbgp
```

Now, for our last agent that will be part of Kentik NMS, we are going to bring this up as a standalone container not controlled via _netlab_, and here is how the _compose_ file looks like:
```yaml
services:
  kagent:
    container_name: kagent
    hostname: iol_kagent
    image: kentik/kagent:latest
    restart: unless-stopped
    network_mode: host
    environment:
      K_COMPANY_ID: < Kentik Company ID >
      K_API_ROOT: grpc.api.kentik.eu:443
    cap_add:
      - NET_RAW
    volumes:
      - kagent-data:/opt/kentik

volumes:
  kagent-data:
    driver: local
```

Two points here worth exploring:
- **kagent** is not part of the topology since currently there is no way to pass the capability to _containerlab_ 
- The agent is going to poll the devices for SNMP so connectivity wise, this works by default since both agent network (host) and topology management networks are on the same host (WSL)

Now, this seems the case also for the **kproxy** container, but here, _netlab_ is going to need its' IP address in order to add additional configuration to the devices exporting flows as we are going to see in the following paragraphs.

One last part to cover here is the fact that we have to provision our network devices accordingly in order to be ready to integrate with Kentik. This means that: 
1. They need to be sending netflow to **kproxy**
2. They need to have snmp enabled in order to be polled by **kproxy** and **kagent**
3. They need to be peering with **kbgp** in order to send their BGP tables to Kentik

Well, it seems as a usual case of templating configurations and passing them on to devices via _netlab_.

For the snmp part, we just re-use our `core-extras` template to add the config:
```jinja
< snipped >
{# Enable SNMP #}
!
snmp-server ifindex persist
snmp-server community {{ KENTIK_SNMPV2_COMMUNITY }}
!
```
For the netflow part, IOL supports a feature called Flexible netflow and can do v9 and ipfix as well as standard netflow v9 exports.  I have seen that with Flexible netflow configuration, there is no way to configure the active cache settings and we need this to be 1 min. for Kentik. In any case, here are the respective templates for all three variations of the netflow configurations needed.


```jinja { Title="Standard Netflow v9" }
{% if ACTION is not defined or ACTION not in ['push','remove'] %}
{{_|mandatory("ACTION is mandatoy - push or remove")}}
{% elif ACTION == "remove" %}
!
interface range {% for interface in netlab_interfaces if interface.type != 'loopback' -%}
{{ interface.ifname + " , " if not loop.last else interface.ifname }}{% endfor %}
  no flow-sampler KENTIK
 !
!
no ip flow-export source Ethernet0/0
no ip flow-export version 9 origin-as bgp-nexthop
no ip flow-export template options sampler
no ip flow-export template timeout-rate
no ip flow-export template refresh-rate
no ip flow-export destination {{ hostvars['kproxy']['mgmt']['ipv4'] }} 9995 vrf clab-mgmt
no flow-sampler-map KENTIK
no ip flow-cache timeout inactive
no ip flow-cache timeout active
!
{% elif ACTION == "push" %}
!
ip flow-cache timeout inactive 30
ip flow-cache timeout active 1
!
flow-sampler-map KENTIK
 mode random one-out-of {{ KENTIK_SAMPLE_RATE }}
!
ip flow-export source Ethernet0/0
ip flow-export version 9 origin-as bgp-nexthop
ip flow-export template options sampler
ip flow-export template timeout-rate 1
ip flow-export template refresh-rate 50
ip flow-export destination {{ hostvars['kproxy']['mgmt']['ipv4'] }} 9995 vrf clab-mgmt
!
interface range {% for interface in netlab_interfaces if interface.type != 'loopback' -%}
{{ interface.ifname + " , " if not loop.last else interface.ifname }}{% endfor %}
  flow-sampler KENTIK
!
{% endif %}
```

```jinja { Title="Flexible Netflow v9" hl_lines=[40] }
{% if ACTION is not defined or ACTION not in ['push','remove'] %}
 {{_|mandatory("ACTION is mandatoy - push or remove")}}
{% elif ACTION == "remove" %}
!
interface range {% for interface in netlab_interfaces if interface.type != 'loopback' -%}
{{ interface.ifname + " , " if not loop.last else interface.ifname }}{% endfor %}
  no ip flow monitor KENTIK sampler KENTIK input
 !
!
no sampler KENTIK
no flow monitor KENTIK
no flow exporter KENTIK
no flow record KENTIK
!
{% elif ACTION == "push" %}
!
flow record KENTIK
 match routing vrf input
 match ipv4 tos
 match ipv4 protocol
 match ipv4 source address
 match ipv4 destination address
 match transport source-port
 match transport destination-port
 match interface input
 collect routing source as
 collect routing destination as
 collect routing next-hop address ipv4
 collect transport tcp flags
 collect interface output
 collect counter bytes
 collect counter packets
 collect timestamp sys-uptime first
 collect timestamp sys-uptime last
!
flow exporter KENTIK
 destination {{ hostvars['kproxy']['mgmt']['ipv4'] }} vrf clab-mgmt
 source Ethernet0/0
 transport udp 9995
 export-protocol netflow-v9
 template data timeout 60
 option interface-table
 option vrf-table
 option sampler-table
!
flow monitor KENTIK
 exporter KENTIK
 statistics packet protocol
 statistics packet size
 record KENTIK
!
sampler KENTIK
 mode random 1 out-of {{ KENTIK_SAMPLE_RATE }}
!
interface range {% for interface in netlab_interfaces if interface.type != 'loopback' -%}
{{ interface.ifname + " , " if not loop.last else interface.ifname }}{% endfor %}
  ip flow monitor KENTIK sampler KENTIK input
!
{% endif %}
```

```jinja { Title="Flexible IPFIX" hl_lines=[40] }
{% if ACTION is not defined or ACTION not in ['push','remove'] %}
 {{_|mandatory("ACTION is mandatoy - push or remove")}}
{% elif ACTION == "remove" %}
!
interface range {% for interface in netlab_interfaces if interface.type != 'loopback' -%}
{{ interface.ifname + " , " if not loop.last else interface.ifname }}{% endfor %}
  no ip flow monitor KENTIK sampler KENTIK input
 !
!
no sampler KENTIK
no flow monitor KENTIK
no flow exporter KENTIK
no flow record KENTIK
!
{% elif ACTION == "push" %}
!
flow record KENTIK
 match routing vrf input
 match ipv4 tos
 match ipv4 protocol
 match ipv4 source address
 match ipv4 destination address
 match transport source-port
 match transport destination-port
 match interface input
 collect routing source as
 collect routing destination as
 collect routing next-hop address ipv4
 collect transport tcp flags
 collect interface output
 collect counter bytes
 collect counter packets
 collect timestamp sys-uptime first
 collect timestamp sys-uptime last
!
flow exporter KENTIK
 destination {{ hostvars['kproxy']['mgmt']['ipv4'] }} vrf clab-mgmt
 source Ethernet0/0
 transport udp 9995
 export-protocol ipfix
 template data timeout 60
 option interface-table
 option vrf-table
 option sampler-table
!
flow monitor KENTIK
 exporter KENTIK
 statistics packet protocol
 statistics packet size
 record KENTIK
!
sampler KENTIK
 mode random 1 out-of {{ KENTIK_SAMPLE_RATE }}
!
interface range {% for interface in netlab_interfaces if interface.type != 'loopback' -%}
{{ interface.ifname + " , " if not loop.last else interface.ifname }}{% endfor %}
  ip flow monitor KENTIK sampler KENTIK input
!
{% endif %}
```

All three templates include the respective _no_ statements so you can provision them via the `netlab config` command and switch between them on the devices.

Now, last but not least, we have the BGP configuration. Kentik acts as a route reflector and we peer with the enabled address families via **kbgp** to send both tables from each device.
```jinja { Title="BGP Configuration" }
!
ip prefix-list PL_HOSTS seq 5 permit 0.0.0.0/0 ge 32
ip prefix-list PL_DEFAULT seq 5 permit 0.0.0.0/0
!
route-map RM_KENTIK_IN permit 5
  match ip address prefix-list PL_HOSTS
!
route-map RM_KENTIK_OUT deny 5
  match ip address prefix-list PL_DEFAULT
!
route-map RM_KENTIK_OUT permit 10
 set community {{ bgp.as }}:{{ id*100 }} additive
 set extcommunity color {{ id+10 }} additive
!
route-map RM_IBGP_OUT permit 5
 set community {{ bgp.as }}:{{ id*100 }} additive
 set extcommunity color {{ id+10 }} additive
!
router bgp {{ bgp.as }}
    neighbor {{ hosts['kbgp']['ipv4'][0] }} remote-as {{ bgp.as }}
    neighbor {{ hosts['kbgp']['ipv4'][0] }} description KENTIK
    neighbor {{ hosts['kbgp']['ipv4'][0] }} update-source {{ loopback.ifname }}
!
address-family ipv4
    neighbor {{ hosts['kbgp']['ipv4'][0] }} activate
    neighbor {{ hosts['kbgp']['ipv4'][0] }} route-reflector-client
    neighbor {{ hosts['kbgp']['ipv4'][0] }} route-map RM_KENTIK_IN in
    neighbor {{ hosts['kbgp']['ipv4'][0] }} route-map RM_KENTIK_OUT out
{% for nei in bgp.neighbors if nei.type == 'ibgp' %}
    neighbor {{ nei.ipv4 }} route-map RM_IBGP_OUT out
{% endfor %}
!
address-family vpnv4
    neighbor {{ hosts['kbgp']['ipv4'][0] }} activate
    neighbor {{ hosts['kbgp']['ipv4'][0] }} route-reflector-client
!

```
The BGP template is provisioned to the devices during lab bring up, so it is defined in the `config` section of the core devices. 

You see now how we can leverage the ansible variables available to us to produce the appropriate configuration.  So we define those _additional_ variables in our topology file in the appropriate section.

```yaml { .no-header hl_lines=["9-10"] }
groups:
  core:
    members: [ rc1, rc2, rc3, rc4 ]
    module: [ ospf, bgp, mpls, vrf ]
    bgp.as: 65515
    mpls.vpn: [ ibgp ]
    vrf.loopback: true
    config: [ core_extras, kentik_rrc ]
    vars:
      KENTIK_SNMPV2_COMMUNITY: < snmpv2 community >
      KENTIK_SAMPLE_RATE: 10
      KENTIK_REGION: EU
      KENTIK_PLAN_ID: < Flow Plan for devices >
      KENTIK_SITE_ID: < Site to use for the devices >
      KENTIK_NMS_AGENT_ID: < NMS agent to use for polling devices >
      KENTIK_NMS_CREDS_NAME: < Credentials vault name >
      KENTIK_API_TOKEN: < Kentik User Token >
      KENTIK_API_EMAIL: < Kentik User Email >
```

We have defined some additional variables here that we do not use during _netlab_ normal operations. The reason for this is that since _netlab_ will create a full ansible structure for the lab, we can re-use this to run our own plays based on the inventory that _netlab_ created. More on this in our next section.

## Topology Bring-Up Workflow

In this section we will cover the steps needed to bring up the LAB and start with our use-case. In a high-level here are the steps needed to accomplish this:

1. Register the NMS agent
2. Register the networking devices in the portal
3. Bring Up the LAB
4. Enable the desired netflow export
5. Enable traffic
7. Register the ksynth agents

In addition, here are the additional variables we are using in the topology file along with their description and their requirement for the above steps

| VARIABLE                | USED IN | DESCRIPTION                                                     |
| ----------------------- | ------- | --------------------------------------------------------------- |
| KENTIK_SNMPV2_COMMUNITY | 2,3     | SNMPv2 community used to poll the devices                       |
| KENTIK_SAMPLE_RATE      | 2,4     | Netflow sample rate configured on the devices and in the portal |
| KENTIK_REGION           | 2,3     | Portal Account region - US or EU                                |
| KENTIK_PLAN_ID          | 2       | Portal flow plan to put the devices in                          |
| KENTIK_SITE_ID          | 2       | Portal site to put the devices in                               |
| KENTIK_NMS_AGENT_ID     | 2       | NMS agent to poll the devices                                   |
| KENTIK_NMS_CREDS_NAME   | 2       | Portal credential vault having the snmp community               |
| KENTIK_API_TOKEN        | 2,3     | Portal API token to authenticate to Kentik                      |
| KENTIK_API_EMAIL        | 2,3     | Portal Email account to authenticate to Kentik                  |
| IPERF3_TESTS            | 3,5     | List of dictionaries describing the iperf3 tests                |

### 1. Register NMS Agent

This an once-off action and it is decoupled from _netlab_. We just need to run the **kagent** and register it in the portal. This will allow us to get the `AGENT_ID` for the next step.

So, using the docker compose we bring up the agent and then access the portal to activate it and get the ID.
```bash
(wsl)<<· docker compose up -d
[+] Running 2/2
 ✔ Volume "iol_kagent-data"  Created                                                         0.0s
 ✔ Container kagent          Started                                                         0.2s
```
In addition we can assign the agent to an existing site or create a new one in the portal that we will use for our LAB. This will also give us the `SITE_ID` variable for the next step.

### 2. Register Devices in the Portal
This is again an once-off task and we could do it manually, but since _netlab_ is able to give us an ansible inventory structure out of the topology file we can use this and create the devices via Kentik's device API in our own playbook.

Here is a playbook that accomplishes this task:
```yaml
---
- name: "Kentik Device Onboarding"
  hosts: core
  gather_facts: false
  vars:
    KENTIK_API_URL: "https://grpc.api.kentik.{{ KENTIK_REGION|lower }}"
    KENTIK_DEVICE_API: "{{ KENTIK_API_URL }}/device/v202308beta1/device/"
    KENTIK_HEADERS: 
          X-CH-Auth-API-Token: "{{ KENTIK_API_TOKEN }}"
          X-CH-Auth-Email: "{{ KENTIK_API_EMAIL }}"
          Content-Type: application/json
  tasks:
    - name: Get Current Devices
      uri:
        url: "{{ KENTIK_DEVICE_API }}"
        method: GET
        headers: "{{ KENTIK_HEADERS }}"
        status_code: 200
      register: devices    
      delegate_to: localhost
      run_once: true
    
    - name: Skipped Devices
      debug:
        msg: "Device name or IP addresses already existed in portal"
      when: 
        - "netlab_name+'-'+hostname in devices.json | json_query('devices[].deviceName')
          or mgmt.ipv4 in devices.json | json_query('devices[].sendingIps[]')
          or bgp.router_id in devices.json | json_query('devices[].deviceBgpNeighborIp')"
      delegate_to: localhost


    - name: Create Device OR Skip If Exists
      block:
        - name: Create Device Call
          ansible.builtin.uri:
            url: "{{ KENTIK_DEVICE_API }}"
            method: POST
            headers: "{{ KENTIK_HEADERS }}"
            status_code: 200
            body: "{{ lookup('ansible.builtin.template','templates/kentik_device.j2') }}"
            body_format: json
            timeout: 60
          register: device_created
          throttle: 1
        - name: Devices Created
          debug: 
            msg: "Device created with id: {{ device_created.json.device.id }}"
      rescue:
        - name: Cannot Create Device
          debug:
            msg: "Failed to create device: {{ device_created.json.message }}"
      when: 
        - "netlab_name+'-'+hostname not in devices.json | json_query('devices[].deviceName')"
        - "mgmt.ipv4 not in devices.json | json_query('devices[].sendingIps[]')"
        - "bgp.router_id not in devices.json | json_query('devices[].deviceBgpNeighborIp')"
      delegate_to: localhost
    

```
We are using the built in `uri` module to interact with the API and create the devices we are interested in, i.e. the `core` devices. The playbook will check if there is any existing device with the same name or having any relevant IP that we use in our LAB, and if not it will create the device in the portal. 

The _json_ payload is templated and looks like this:
```json
{
  "device": {
    "deviceName": "{{ netlab_name }}-{{ hostname }}",
    "deviceDescription": "Device {{ id }} of type {{ netlab_device_type}} using {{ netlab_provider}} provider.",
    "deviceSubtype": "router",
    "sendingIps": [
      "{{ mgmt.ipv4}}"
    ],
    "deviceSampleRate": "{{ KENTIK_SAMPLE_RATE }}",
    "planId": {{ KENTIK_PLAN_ID }},
    "siteId": {{ KENTIK_SITE_ID }},
    "minimizeSnmp": false,
    "deviceSnmpIp": "{{ mgmt.ipv4}}",
    "deviceSnmpCommunity": "{{ KENTIK_SNMPV2_COMMUNITY }}",
    "deviceBgpType": "device",
    "deviceBgpNeighborIp": "{{ bgp.router_id }}",
    "deviceBgpNeighborAsn": "{{ bgp.as }}",
    "nms": {
      "agentId": "{{ KENTIK_NMS_AGENT_ID }}",
      "ipAddress": "{{ mgmt.ipv4 }}",
      "snmp": {
        "credentialName": "{{ KENTIK_NMS_CREDS_NAME }}",
      },
    }
 }
}
```

So we are going to need to provide the remaining values for the variables used in our topology file and once all variables are filled in, we can execute the `netlab create`  command in order for the ansible inventory to be produced.
```bash
(wsl)<<· netlab create
[CREATED] provider configuration file: clab.yml
[MAPPED]  clab_files/kproxy/hosts to kproxy:/etc/hosts (from templates/provider/clab/linux/hosts.j2)
[MAPPED]  clab_files/ksynth1/hosts to ksynth1:/etc/hosts (from templates/provider/clab/linux/hosts.j2)
[MAPPED]  clab_files/ksynth2/hosts to ksynth2:/etc/hosts (from templates/provider/clab/linux/hosts.j2)
[MAPPED]  clab_files/ksynth3/hosts to ksynth3:/etc/hosts (from templates/provider/clab/linux/hosts.j2)
[MAPPED]  clab_files/ksynth4/hosts to ksynth4:/etc/hosts (from templates/provider/clab/linux/hosts.j2)
[MAPPED]  clab_files/kbgp/hosts to kbgp:/etc/hosts (from templates/provider/clab/linux/hosts.j2)
[MAPPED]  clab_files/pc1/hosts to pc1:/etc/hosts (from templates/provider/clab/linux/hosts.j2)
[MAPPED]  clab_files/pc2/hosts to pc2:/etc/hosts (from templates/provider/clab/linux/hosts.j2)
[MAPPED]  clab_files/pc3/hosts to pc3:/etc/hosts (from templates/provider/clab/linux/hosts.j2)
[MAPPED]  clab_files/pc4/hosts to pc4:/etc/hosts (from templates/provider/clab/linux/hosts.j2)
[MAPPED]  clab_files/pc11/hosts to pc11:/etc/hosts (from templates/provider/clab/linux/hosts.j2)
[MAPPED]  clab_files/pc12/hosts to pc12:/etc/hosts (from templates/provider/clab/linux/hosts.j2)
[MAPPED]  clab_files/pc13/hosts to pc13:/etc/hosts (from templates/provider/clab/linux/hosts.j2)
[MAPPED]  clab_files/pc14/hosts to pc14:/etc/hosts (from templates/provider/clab/linux/hosts.j2)
[CREATED] transformed topology dump in YAML format in netlab.snapshot.yml
[GROUPS]  group_vars for all
[GROUPS]  group_vars for modules
[GROUPS]  group_vars for custom_configs
[GROUPS]  group_vars for iol
[HOSTS]   host_vars for rc1
[HOSTS]   host_vars for rc2
[HOSTS]   host_vars for rc3
[HOSTS]   host_vars for rc4
[HOSTS]   host_vars for ce1
[HOSTS]   host_vars for ce2
[HOSTS]   host_vars for ce3
[HOSTS]   host_vars for ce4
[GROUPS]  group_vars for linux
[HOSTS]   host_vars for kproxy
[HOSTS]   host_vars for ksynth1
[HOSTS]   host_vars for ksynth2
[HOSTS]   host_vars for ksynth3
[HOSTS]   host_vars for ksynth4
[HOSTS]   host_vars for kbgp
[HOSTS]   host_vars for pc1
[HOSTS]   host_vars for pc2
[HOSTS]   host_vars for pc3
[HOSTS]   host_vars for pc4
[HOSTS]   host_vars for pc11
[HOSTS]   host_vars for pc12
[HOSTS]   host_vars for pc13
[HOSTS]   host_vars for pc14
[GROUPS]  group_vars for core
[GROUPS]  group_vars for pcs
[CREATED] minimized Ansible inventory hosts.yml
[CREATED] Ansible configuration file: ansible.cfg
```

Now we can run our playbook to onboard the core devices into Kentik.
```bash
(wsl)<<· ANSIBLE_NOCOWS=1 ansible-playbook kentik.yml

PLAY [Kentik Device Onboarding] *******************************************************************************************

TASK [Get Current Devices] ************************************************************************************************
ok: [rc1 -> localhost]

TASK [Skipped Devices] ****************************************************************************************************
skipping: [rc1]
skipping: [rc2]
skipping: [rc3]
skipping: [rc4]

TASK [Create Device Call] *************************************************************************************************
ok: [rc1 -> localhost]
ok: [rc2 -> localhost]
ok: [rc3 -> localhost]
ok: [rc4 -> localhost]

TASK [Devices Created] ****************************************************************************************************
ok: [rc1 -> localhost] =>
  msg: 'Device created with id: 115531'
ok: [rc2 -> localhost] =>
  msg: 'Device created with id: 115536'
ok: [rc3 -> localhost] =>
  msg: 'Device created with id: 115541'
ok: [rc4 -> localhost] =>
  msg: 'Device created with id: 115546'

PLAY RECAP ****************************************************************************************************************
rc1                        : ok=3    changed=0    unreachable=0    failed=0    skipped=1    rescued=0    ignored=0
rc2                        : ok=2    changed=0    unreachable=0    failed=0    skipped=1    rescued=0    ignored=0
rc3                        : ok=2    changed=0    unreachable=0    failed=0    skipped=1    rescued=0    ignored=0
rc4                        : ok=2    changed=0    unreachable=0    failed=0    skipped=1    rescued=0    ignored=0
```


### 3. Bring Up the LAB
We are ready now to bring up the topology. We have seen that during `netlab create` _netlab_ will create the required _containerlab_ topology file and populate our ansible inventory with the appropriate files and values. Using the `netlab up` command it will execute the create phase as well as spin up the nodes and start provisioning them with the appropriate configurations we defined in the topology file.
```bash
(wsl)<<· ANSIBLE_NOCOWS=1 netlab up

< snipped >

PLAY RECAP ****************************************************************************************************************
ce1                        : ok=25   changed=4    unreachable=0    failed=0    skipped=14   rescued=0    ignored=0
ce2                        : ok=24   changed=3    unreachable=0    failed=0    skipped=14   rescued=0    ignored=0
ce3                        : ok=24   changed=3    unreachable=0    failed=0    skipped=14   rescued=0    ignored=0
ce4                        : ok=24   changed=3    unreachable=0    failed=0    skipped=14   rescued=0    ignored=0
kbgp                       : ok=11   changed=3    unreachable=0    failed=0    skipped=2    rescued=0    ignored=0
kproxy                     : ok=11   changed=3    unreachable=0    failed=0    skipped=2    rescued=0    ignored=0
ksynth1                    : ok=11   changed=3    unreachable=0    failed=0    skipped=2    rescued=0    ignored=0
ksynth2                    : ok=11   changed=3    unreachable=0    failed=0    skipped=2    rescued=0    ignored=0
ksynth3                    : ok=11   changed=3    unreachable=0    failed=0    skipped=2    rescued=0    ignored=0
ksynth4                    : ok=11   changed=3    unreachable=0    failed=0    skipped=2    rescued=0    ignored=0
pc1                        : ok=19   changed=5    unreachable=0    failed=0    skipped=5    rescued=0    ignored=0
pc11                       : ok=19   changed=5    unreachable=0    failed=0    skipped=5    rescued=0    ignored=0
pc12                       : ok=19   changed=5    unreachable=0    failed=0    skipped=5    rescued=0    ignored=0
pc13                       : ok=19   changed=5    unreachable=0    failed=0    skipped=5    rescued=0    ignored=0
pc14                       : ok=19   changed=5    unreachable=0    failed=0    skipped=5    rescued=0    ignored=0
pc2                        : ok=19   changed=5    unreachable=0    failed=0    skipped=5    rescued=0    ignored=0
pc3                        : ok=19   changed=5    unreachable=0    failed=0    skipped=5    rescued=0    ignored=0
pc4                        : ok=19   changed=5    unreachable=0    failed=0    skipped=5    rescued=0    ignored=0
rc1                        : ok=48   changed=8    unreachable=0    failed=0    skipped=11   rescued=0    ignored=0
rc2                        : ok=48   changed=8    unreachable=0    failed=0    skipped=11   rescued=0    ignored=0
rc3                        : ok=48   changed=8    unreachable=0    failed=0    skipped=11   rescued=0    ignored=0
rc4                        : ok=48   changed=8    unreachable=0    failed=0    skipped=11   rescued=0    ignored=0

[SUCCESS] Lab devices configured

(wsl)<<· netlab status
Lab default in /home/netlab/iol
  status: started
  provider(s): clab

┏━━━━━━━━━┳━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━┳━━━━━━━━━━┳━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━┓
┃ node    ┃ device ┃ image                       ┃ mgmt IPv4       ┃ connection  ┃ provider ┃ VM/container ┃ status       ┃
┡━━━━━━━━━╇━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━╇━━━━━━━━━━╇━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━┩
│ ce1     │ iol    │ vrnetlab/cisco_iol:17.12.1  │ 192.168.121.111 │ network_cli │ clab     │ ce1          │ Up 3 minutes │
├─────────┼────────┼─────────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼──────────────┤
│ ce2     │ iol    │ vrnetlab/cisco_iol:17.12.1  │ 192.168.121.112 │ network_cli │ clab     │ ce2          │ Up 3 minutes │
├─────────┼────────┼─────────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼──────────────┤
│ ce3     │ iol    │ vrnetlab/cisco_iol:17.12.1  │ 192.168.121.113 │ network_cli │ clab     │ ce3          │ Up 3 minutes │
├─────────┼────────┼─────────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼──────────────┤
│ ce4     │ iol    │ vrnetlab/cisco_iol:17.12.1  │ 192.168.121.114 │ network_cli │ clab     │ ce4          │ Up 3 minutes │
├─────────┼────────┼─────────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼──────────────┤
│ kbgp    │ linux  │ ghcr.io/srl-labs/network-m… │ 192.168.121.110 │ docker      │ clab     │ kbgp         │ Up 3 minutes │
├─────────┼────────┼─────────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼──────────────┤
│ kproxy  │ linux  │ ghcr.io/srl-labs/network-m… │ 192.168.121.105 │ docker      │ clab     │ kproxy       │ Up 3 minutes │
├─────────┼────────┼─────────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼──────────────┤
│ ksynth1 │ linux  │ ghcr.io/srl-labs/network-m… │ 192.168.121.106 │ docker      │ clab     │ ksynth1      │ Up 3 minutes │
├─────────┼────────┼─────────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼──────────────┤
│ ksynth2 │ linux  │ ghcr.io/srl-labs/network-m… │ 192.168.121.107 │ docker      │ clab     │ ksynth2      │ Up 3 minutes │
├─────────┼────────┼─────────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼──────────────┤
│ ksynth3 │ linux  │ ghcr.io/srl-labs/network-m… │ 192.168.121.108 │ docker      │ clab     │ ksynth3      │ Up 3 minutes │
├─────────┼────────┼─────────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼──────────────┤
│ ksynth4 │ linux  │ ghcr.io/srl-labs/network-m… │ 192.168.121.109 │ docker      │ clab     │ ksynth4      │ Up 3 minutes │
├─────────┼────────┼─────────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼──────────────┤
│ pc1     │ linux  │ ghcr.io/srl-labs/network-m… │ 192.168.121.115 │ docker      │ clab     │ pc1          │ Up 3 minutes │
├─────────┼────────┼─────────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼──────────────┤
│ pc11    │ linux  │ ghcr.io/srl-labs/network-m… │ 192.168.121.119 │ docker      │ clab     │ pc11         │ Up 3 minutes │
├─────────┼────────┼─────────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼──────────────┤
│ pc12    │ linux  │ ghcr.io/srl-labs/network-m… │ 192.168.121.120 │ docker      │ clab     │ pc12         │ Up 3 minutes │
├─────────┼────────┼─────────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼──────────────┤
│ pc13    │ linux  │ ghcr.io/srl-labs/network-m… │ 192.168.121.121 │ docker      │ clab     │ pc13         │ Up 3 minutes │
├─────────┼────────┼─────────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼──────────────┤
│ pc14    │ linux  │ ghcr.io/srl-labs/network-m… │ 192.168.121.122 │ docker      │ clab     │ pc14         │ Up 3 minutes │
├─────────┼────────┼─────────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼──────────────┤
│ pc2     │ linux  │ ghcr.io/srl-labs/network-m… │ 192.168.121.116 │ docker      │ clab     │ pc2          │ Up 3 minutes │
├─────────┼────────┼─────────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼──────────────┤
│ pc3     │ linux  │ ghcr.io/srl-labs/network-m… │ 192.168.121.117 │ docker      │ clab     │ pc3          │ Up 3 minutes │
├─────────┼────────┼─────────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼──────────────┤
│ pc4     │ linux  │ ghcr.io/srl-labs/network-m… │ 192.168.121.118 │ docker      │ clab     │ pc4          │ Up 3 minutes │
├─────────┼────────┼─────────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼──────────────┤
│ rc1     │ iol    │ vrnetlab/cisco_iol:17.12.1  │ 192.168.121.101 │ network_cli │ clab     │ rc1          │ Up 3 minutes │
├─────────┼────────┼─────────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼──────────────┤
│ rc2     │ iol    │ vrnetlab/cisco_iol:17.12.1  │ 192.168.121.102 │ network_cli │ clab     │ rc2          │ Up 3 minutes │
├─────────┼────────┼─────────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼──────────────┤
│ rc3     │ iol    │ vrnetlab/cisco_iol:17.12.1  │ 192.168.121.103 │ network_cli │ clab     │ rc3          │ Up 3 minutes │
├─────────┼────────┼─────────────────────────────┼─────────────────┼─────────────┼──────────┼──────────────┼──────────────┤
│ rc4     │ iol    │ vrnetlab/cisco_iol:17.12.1  │ 192.168.121.104 │ network_cli │ clab     │ rc4          │ Up 3 minutes │
└─────────┴────────┴─────────────────────────────┴─────────────────┴─────────────┴──────────┴──────────────┴──────────────┘
```

Here are some connectivity tests and also notice the bitrates:
```bash
(wsl)<<· netlab exec pc1 iperf3 -c pc4
Connecting to container pc1, executing iperf3 -c pc4
Connecting to host pc4, port 5201
[  5] local 172.16.0.15 port 42090 connected to 172.16.3.18 port 5201
[ ID] Interval           Transfer     Bitrate         Retr  Cwnd
[  5]   0.00-1.00   sec  32.5 MBytes   273 Mbits/sec  498   14.1 KBytes
[  5]   1.00-2.00   sec  30.1 MBytes   252 Mbits/sec  457   14.1 KBytes
[  5]   2.00-3.00   sec  30.7 MBytes   258 Mbits/sec  475   12.7 KBytes
[  5]   3.00-4.00   sec  28.0 MBytes   235 Mbits/sec  438   14.1 KBytes
[  5]   4.00-5.00   sec  29.4 MBytes   247 Mbits/sec  458   14.1 KBytes
[  5]   5.00-6.00   sec  29.8 MBytes   250 Mbits/sec  483   8.46 KBytes
[  5]   6.00-7.00   sec  28.5 MBytes   239 Mbits/sec  494   22.6 KBytes
[  5]   7.00-8.00   sec  28.4 MBytes   239 Mbits/sec  537   11.3 KBytes
[  5]   8.00-9.00   sec  25.2 MBytes   212 Mbits/sec  410   14.1 KBytes
[  5]   9.00-10.00  sec  24.0 MBytes   201 Mbits/sec  476   14.1 KBytes
- - - - - - - - - - - - - - - - - - - - - - - - -
[ ID] Interval           Transfer     Bitrate         Retr
[  5]   0.00-10.00  sec   287 MBytes   241 Mbits/sec  4726             sender
[  5]   0.00-10.00  sec   286 MBytes   240 Mbits/sec                  receiver

iperf Done.

(wsl)<<· netlab exec pc11 iperf3 -c pc14
Connecting to container pc11, executing iperf3 -c pc14
Connecting to host pc14, port 5201
[  5] local 172.16.9.19 port 43696 connected to 172.16.12.22 port 5201
[ ID] Interval           Transfer     Bitrate         Retr  Cwnd
[  5]   0.00-1.00   sec  10.5 MBytes  88.2 Mbits/sec  259   14.1 KBytes
[  5]   1.00-2.00   sec  10.5 MBytes  88.1 Mbits/sec  257   12.7 KBytes
[  5]   2.00-3.00   sec  11.1 MBytes  93.3 Mbits/sec  243   14.1 KBytes
[  5]   3.00-4.00   sec  10.6 MBytes  89.2 Mbits/sec  258   15.5 KBytes
[  5]   4.00-5.00   sec  11.4 MBytes  95.4 Mbits/sec  254   12.7 KBytes
[  5]   5.00-6.00   sec  10.5 MBytes  88.1 Mbits/sec  252   14.1 KBytes
[  5]   6.00-7.00   sec  11.1 MBytes  93.3 Mbits/sec  233   14.1 KBytes
[  5]   7.00-8.00   sec  12.0 MBytes   101 Mbits/sec  276   14.1 KBytes
[  5]   8.00-9.00   sec  11.5 MBytes  96.4 Mbits/sec  214   19.7 KBytes
[  5]   9.00-10.00  sec  11.4 MBytes  95.4 Mbits/sec  247   15.5 KBytes
- - - - - - - - - - - - - - - - - - - - - - - - -
[ ID] Interval           Transfer     Bitrate         Retr
[  5]   0.00-10.00  sec   111 MBytes  92.8 Mbits/sec  2493             sender
[  5]   0.00-10.00  sec   110 MBytes  92.6 Mbits/sec                  receiver

iperf Done.

(wsl)<<· netlab exec pc11 mtr pc14 -r
Connecting to container pc11, executing mtr pc14 -r
Start: 2024-12-07T18:02:20+0000
HOST: pc11                        Loss%   Snt   Last   Avg  Best  Wrst StDev
  1.|-- Ethernet0-2.ce1            0.0%    10    0.5   0.6   0.5   0.7   0.1
  2.|-- Ethernet1-2.blue.rc1       0.0%    10    0.7   1.2   0.7   1.8   0.4
  3.|-- Ethernet0-1.rc2            0.0%    10    2.2   3.0   2.2   3.6   0.4
  4.|-- Ethernet1-1.blue.rc4       0.0%    10    2.4   2.4   1.9   3.0   0.3
  5.|-- Ethernet0-1.ce4            0.0%    10    1.4   2.7   1.4   3.5   0.8
  6.|-- pc14                       0.0%    10    1.5   2.6   1.5   3.9   0.8

```


{{< admonition tip  >}}
host resolution works by default since _netlab_ takes care of that by producing a `hosts` file, attaching it into the linux containers, and provisions all hosts in the network devices as well. How cool is that!!!
{{< /admonition  >}}
### 4. Enable Netflow
So now that we have our test network ready, we can enable netflow on the core routers by choosing our netflow flavour and provision the respective commands via the `netlab config` command:
```bash
(wsl)<<· ANSIBLE_NOCOWS=1 netlab config kentik_flow -l core -e ACTION=push
< snipped >

PLAY RECAP ****************************************************************************************************************
rc1                        : ok=7    changed=1    unreachable=0    failed=0    skipped=4    rescued=0    ignored=0
rc2                        : ok=7    changed=1    unreachable=0    failed=0    skipped=3    rescued=0    ignored=0
rc3                        : ok=7    changed=1    unreachable=0    failed=0    skipped=3    rescued=0    ignored=0
rc4                        : ok=7    changed=1    unreachable=0    failed=0    skipped=3    rescued=0    ignored=0

```

We can use this method to re-configure any other flow configuration ad-hoc by leveraging the `ACTION` variable.

Let's check on the kproxy after a while to see that all devices are sending flows and are correctly registered with the portal:
```bash
(wsl)<<· telnet kproxy 9996
Trying 192.168.121.105...
Connected to kproxy.
Escape character is '^]'.
GOOD

4 Connected Devices
* 29118:iol-rc3:115541 -> 0.0.0.0:40016 (In1: 0.116060, Out1: 0.108333, In15: 0.191401, Out15: 0.009772). Last seen 2024-12-07T18:17:32.509264 (8.195s ago). Sources: 192.168.121.103. Channel highwater: 0, 0, 0. Flow: netflow.v9
* 29118:iol-rc1:115531 -> 0.0.0.0:40010 (In1: 0.119930, Out1: 0.081798, In15: 0.191431, Out15: 0.008598). Last seen 2024-12-07T18:17:35.463030 (7.186s ago). Sources: 192.168.121.101. Channel highwater: 0, 0, 0. Flow: netflow.v9
* 29118:iol-rc2:115536 -> 0.0.0.0:40012 (In1: 0.094682, Out1: 0.027546, In15: 0.189246, Out15: 0.003203). Last seen 2024-12-07T18:17:28.505189 (12.199s ago). Sources: 192.168.121.102. Channel highwater: 0, 0, 0. Flow: netflow.v9
* 29118:iol-rc4:115546 -> 0.0.0.0:40014 (In1: 0.102966, Out1: 0.108333, In15: 0.190311, Out15: 0.009772). Last seen 2024-12-07T18:17:19.681646 (21.022s ago). Sources: 192.168.121.104. Channel highwater: 0, 0, 0. Flow: netflow.v9

0 Unregistered Devices

Connection closed by foreign host.

```


### 5. Enable Traffic
Our `PC's` are already listening to the appropriate ports for the traffic tests, so we can run the clients using the respective template:

```bash
(wsl)·>> ANSIBLE_NOCOWS=1 netlab config iperf3_clients -l pcs -e ACTION=run
< snipped >

PLAY RECAP ****************************************************************************************************************
pc1                        : ok=9    changed=3    unreachable=0    failed=0    skipped=4    rescued=0    ignored=0
pc11                       : ok=9    changed=3    unreachable=0    failed=0    skipped=3    rescued=0    ignored=0
pc12                       : ok=9    changed=3    unreachable=0    failed=0    skipped=3    rescued=0    ignored=0
pc13                       : ok=9    changed=3    unreachable=0    failed=0    skipped=3    rescued=0    ignored=0
pc14                       : ok=9    changed=3    unreachable=0    failed=0    skipped=3    rescued=0    ignored=0
pc2                        : ok=9    changed=3    unreachable=0    failed=0    skipped=3    rescued=0    ignored=0
pc3                        : ok=9    changed=3    unreachable=0    failed=0    skipped=3    rescued=0    ignored=0
pc4                        : ok=9    changed=3    unreachable=0    failed=0    skipped=3    rescued=0    ignored=0
```

The same applies to this step as well. We can stop, start and reconfigure the test parameters in our template at any point using the appropriate `ACTION` value.

Here are some outputs from the devices:
```bash
(wsl)<<· netlab exec rc1 sh int e0/3 \| i rate
Connecting to rc1 using SSH port 22, executing sh int e0/3 | i rate

  Queueing strategy: fifo
  5 minute input rate 32387000 bits/sec, 3279 packets/sec
  5 minute output rate 16295000 bits/sec, 2494 packets/sec
Connection to rc1 closed by remote host.

(wsl)·>> netlab exec ce2 sh int e0/1 \| i rate
Connecting to ce2 using SSH port 22, executing sh int e0/1 | i rate


  Queueing strategy: fifo
  5 minute input rate 21226000 bits/sec, 2532 packets/sec
  5 minute output rate 22546000 bits/sec, 2651 packets/sec
Connection to ce2 closed by remote host.


```

And here is how it looks in Kentik

{{< image src="traffic.png" caption="Top Device by Average bits/s" >}}
### 6. Register Synthetics Agents
Now for the last step, the `ksynth` agents, on their first run they will initialise and appear in the portal as `Pending` until they are activated. We need to activate them in the portal, assign them to the site we are using in the lab, choose the address families enabled, and also provide their private IP address they got from _netlab_.

We can get the IP address with the `netlab inspect` command:
```bash
(wsl)·>> for i in 1 2 3 4 ; do echo -n "ksynth$i ";\
             netlab inspect --node ksynth$i interfaces[0].ipv4 ; done
ksynth1 172.16.4.6/24

ksynth2 172.16.5.7/24

ksynth3 172.16.6.8/24

ksynth4 172.16.7.9/24

```

From this point onwards we can configure our tests in the portal.

## Outro

Well I hope you reached the end of this long post and that by now you have realised how simple it is to bring up a topology in _containerlab_ using _netlab_ to take care of the initial configuration of the underneath connectivity details and protocols running on it.  The topology we used here is very small and simple, indeed, but I think that what _netlab_ has to offer does worth the effort of spending some time in getting to know it better and using it in your use cases or even pipelines.

Let's summarise here the key takeaways of this post:
- We have used _netlab_ to bring up a simple network topology via _containerlab_ and provision the initial configs on the devices based on the supported modules and features
- We have seen how to integrate additional containers interacting with this topology for serving our use case
- We have seen how to use _netlabs'_ ansible inventory to run our own plays extending the usability of the lab
- We have seen how to create additional configurations using templates and provision them ad-hoc to our nodes

Some of my thoughts on more back-blogs coming out of this could be:
- Building IOL containers out of the old images using i386 libraries and also licensing
- Using [_netlab tools_](https://netlab.tools/dev/extools/) for the service containers
- Using [_netlab plugins_](https://netlab.tools/plugins/) to extend the current functionality or even add a new one
- Handling of sensitive data, maybe ansible vault
- Use a wrapper on top to orchestrate the use case, like python invoke
- Use [netlab validation tests](https://netlab.tools/topology/validate/)
- Use [WEmulate](https://wemulate.github.io/wemulate/) to artificially impair links for my Kentik use case, like [this](https://blog.ipspace.net/2024/04/netlab-wemulate/).

<p align="right"><br><br><i>...till next time...have fun!!! </i> </p>

## Influences and Reference

- [netlab](https://netlab.tools/)
- [containerlab](https://containerlab.dev/)
- [vrnetlab for containerlab](https://github.com/hellt/vrnetlab)
- [srl-telemetry-lab](https://github.com/srl-labs/srl-telemetry-lab)
- [Cisco IOL in CML](https://developer.cisco.com/docs/modeling-labs/iol/)
- [My repo for this post](https://github.com/becos76/netlab-iol)



---

> Author:    
> URL: https://net4fungr.github.io/posts/iou-love/  

