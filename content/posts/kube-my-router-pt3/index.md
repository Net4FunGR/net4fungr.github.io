---
title: "Kube my router up! - Last Part"
subtitle: "Test drive google's Kubernetes Network Emulation"
date: 2022-06-06T00:00:00+03:00
lastmod: 2022-06-09T00:00:00+03:00
draft: false
tags: [k8s, kne, netsim]
categories: [Art of Labbing]
collections: [Kube My Router Up!]
toc:
  enable: true
resources:
- name: "featured-image"
  src: "featured-image.jpg"
- name: "featured-image-preview"
  src: "featured-image-preview.jpg"
author: " "
summary: "Final part of testing google's KNE - Installing and using kne_cli to build topologies using srlinux and cEOS."
code:
  copy: false
  maxShownLines: -1
---
___
## [Intro](/posts/kube-my-router-pt1/#intro)
___
## [Part One - Setting up the k8s VMs in EVE-NG](/posts/kube-my-router-pt1/)
___
## [Part Two - Deploying the k8s cluster with kubeadm](/posts/kube-my-router-pt2/)
___
## [Last Part - Installing and testing KNE](/posts/kube-my-router-pt3/)
___
### The Intent
  - Install Google's KNE on the k8s control node
  - Use KNE to create sample topologies
  - Test with Nokia srlinux
  - Test with Arista cEOS
 
The time has come to install Google's KNE!!!. We are going to use the k8s control node for KNEs "control" server, so everything will be installed on it. 
___
### Prepare for KNE installation
___
We need **go** so we are going to install it.
```bash
# Download go
ubuntu@kates-control:~$ wget -q https://go.dev/dl/go1.18.2.linux-amd64.tar.gz

# Install it under our HOME directory
ubuntu@kates-control:~$ tar -xvzf go1.18.2.linux-amd64.tar.gz

# Put it in your PATH
ubuntu@kates-control:~$ export PATH=$PATH:~/go/bin

ubuntu@kates-control:~$ echo !! >> ~/.profile
echo export PATH=$PATH:~/go/bin >> ~/.profile

# Check if it's working
ubuntu@kates-control:~$ go version
go version go1.18.2 linux/amd64
```
___
### Deploy KNE 
___
{{< admonition type=note title="Use of kind" open=true >}}
KNE requires **kind** if you are going to use it in a single node. KNE can also deploy a single node k8s using kind and have it run inside a container. Then all the labs will be deployed into this containerised k8s node.
{{< /admonition >}}

OK! We are now ready to install KNE. There are two ways, either install it via go
```bash
$ go install github.com/google/kne/kne_cli@latest
```
or, clone the repo from github and build it locally, which is what I did.
```bash
ubuntu@kates-control:~$ git clone https://github.com/google/kne.git
Cloning into 'kne'...
remote: Enumerating objects: 2146, done.
remote: Counting objects: 100% (154/154), done.
remote: Compressing objects: 100% (89/89), done.
remote: Total 2146 (delta 66), reused 145 (delta 62), pack-reused 1992
Receiving objects: 100% (2146/2146), 41.28 MiB | 200.00 KiB/s, done.
Resolving deltas: 100% (1052/1052), done.
ubuntu@kates-control:~$

ubuntu@kates-control:~$ cd kne/kne_cli/
ubuntu@kates-control:~/kne/kne_cli$ GOPATH=~/go go install

ubuntu@kates-control:~/kne/kne_cli$ cd
ubuntu@kates-control:~$ kne_cli
Kubernetes Network Emulation CLI.  Works with meshnet to create
layer 2 topology used by containers to layout networks in a k8s
environment.

Usage:
  kne_cli [command]

Available Commands:
  completion  Generate the autocompletion script for the specified shell
  create      Create Topology
  delete      Delete Topology
  deploy      Deploy cluster.
  help        Help about any command
  show        Show Topology
  topology    Topology commands.

Flags:
  -h, --help               help for kne_cli
      --kubecfg string     kubeconfig file (default "/home/ubuntu/.kube/config")
  -v, --verbosity string   log level (default "info")

Use "kne_cli [command] --help" for more information about a command.
ubuntu@kates-control:~$
```

___
### Prepare k8s cluster for KNE
___
We need to install meshnet CNI.
```bash
# Install meshnet from local manifests
ubuntu@kates-control:~$ kubectl apply -k kne/manifests/meshnet/base/
namespace/meshnet created
customresourcedefinition.apiextensions.k8s.io/topologies.networkop.co.uk created
serviceaccount/meshnet created
clusterrole.rbac.authorization.k8s.io/meshnet-clusterrole created
clusterrolebinding.rbac.authorization.k8s.io/meshnet-clusterrolebinding created
daemonset.apps/meshnet created

# Check for any issues
ubuntu@kates-control:~$ kubectl get events -n meshnet
LAST SEEN   TYPE     REASON             OBJECT              MESSAGE
15m         Normal   Scheduled          pod/meshnet-72zz4   Successfully assigned meshnet/meshnet-72zz4 to kates-node-02
15m         Normal   Pulling            pod/meshnet-72zz4   Pulling image "hfam/meshnet:latest"
15m         Normal   Pulled             pod/meshnet-72zz4   Successfully pulled image "hfam/meshnet:latest" in 9.581184132s
15m         Normal   Created            pod/meshnet-72zz4   Created container meshnet
15m         Normal   Started            pod/meshnet-72zz4   Started container meshnet
15m         Normal   Scheduled          pod/meshnet-9vqr2   Successfully assigned meshnet/meshnet-9vqr2 to kates-node-01
15m         Normal   Pulling            pod/meshnet-9vqr2   Pulling image "hfam/meshnet:latest"
15m         Normal   Pulled             pod/meshnet-9vqr2   Successfully pulled image "hfam/meshnet:latest" in 9.716760651s
15m         Normal   Created            pod/meshnet-9vqr2   Created container meshnet
15m         Normal   Started            pod/meshnet-9vqr2   Started container meshnet
15m         Normal   Scheduled          pod/meshnet-fkv2s   Successfully assigned meshnet/meshnet-fkv2s to kates-control
15m         Normal   Pulling            pod/meshnet-fkv2s   Pulling image "hfam/meshnet:latest"
15m         Normal   Pulled             pod/meshnet-fkv2s   Successfully pulled image "hfam/meshnet:latest" in 10.072682996s
15m         Normal   Created            pod/meshnet-fkv2s   Created container meshnet
15m         Normal   Started            pod/meshnet-fkv2s   Started container meshnet
15m         Normal   SuccessfulCreate   daemonset/meshnet   Created pod: meshnet-fkv2s
15m         Normal   SuccessfulCreate   daemonset/meshnet   Created pod: meshnet-72zz4
15m         Normal   SuccessfulCreate   daemonset/meshnet   Created pod: meshnet-9vqr2


# Check the new namespace
ubuntu@kates-control:~$ kubectl get all -n meshnet
NAME                READY   STATUS    RESTARTS   AGE
pod/meshnet-72zz4   1/1     Running   0          15m
pod/meshnet-9vqr2   1/1     Running   0          15m
pod/meshnet-fkv2s   1/1     Running   0          15m

NAME                     DESIRED   CURRENT   READY   UP-TO-DATE   AVAILABLE   NODE SELECTOR              AGE
daemonset.apps/meshnet   3         3         3       3            3           kubernetes.io/arch=amd64   15m

# Check the cni
ubuntu@kates-control:~$ sudo cat /etc/cni/net.d/00-meshnet.conflist
{
        "cniVersion": "0.3.1",
        "name": "cbr0",
        "plugins": [
                {
                        "delegate": {
                                "hairpinMode": true,
                                "isDefaultGateway": true
                        },
                        "type": "flannel"
                },
                {
                        "capabilities": {
                                "portMappings": true
                        },
                        "type": "portmap"
                },
                {
                        "name": "meshnet",
                        "type": "meshnet",
                        "ipam": {},
                        "dns": {}
                }
        ]
}
```
Then we need to install metallb in order to access our nodes from outside k8s.
```bash
# Install from local manifests
ubuntu@kates-control:~$ kubectl apply -f kne/manifests/metallb/namespace.yaml
namespace/metallb-system created

ubuntu@kates-control:~$ kubectl create secret generic -n metallb-system memberlist --from-literal=secretkey="$(openssl rand -base64 128)"
secret/memberlist created

ubuntu@kates-control:~$ kubectl apply -f kne/manifests/metallb/metallb.yaml
Warning: policy/v1beta1 PodSecurityPolicy is deprecated in v1.21+, unavailable in v1.25+
podsecuritypolicy.policy/controller created
podsecuritypolicy.policy/speaker created
serviceaccount/controller created
serviceaccount/speaker created
clusterrole.rbac.authorization.k8s.io/metallb-system:controller created
clusterrole.rbac.authorization.k8s.io/metallb-system:speaker created
role.rbac.authorization.k8s.io/config-watcher created
role.rbac.authorization.k8s.io/pod-lister created
role.rbac.authorization.k8s.io/controller created
clusterrolebinding.rbac.authorization.k8s.io/metallb-system:controller created
clusterrolebinding.rbac.authorization.k8s.io/metallb-system:speaker created
rolebinding.rbac.authorization.k8s.io/config-watcher created
rolebinding.rbac.authorization.k8s.io/pod-lister created
rolebinding.rbac.authorization.k8s.io/controller created
daemonset.apps/speaker created
deployment.apps/controller created

ubuntu@kates-control:~$ kubectl get events -n metallb-system
LAST SEEN   TYPE     REASON              OBJECT                             MESSAGE
70s         Normal   Scheduled           pod/controller-868bf4c94d-dtnmn    Successfully assigned metallb-system/controller-868bf4c94d-dtnmn to kates-node-02
70s         Normal   Pulling             pod/controller-868bf4c94d-dtnmn    Pulling image "quay.io/metallb/controller:v0.12.1"
52s         Normal   Pulled              pod/controller-868bf4c94d-dtnmn    Successfully pulled image "quay.io/metallb/controller:v0.12.1" in 17.316467325s
52s         Normal   Created             pod/controller-868bf4c94d-dtnmn    Created container controller
52s         Normal   Started             pod/controller-868bf4c94d-dtnmn    Started container controller
70s         Normal   SuccessfulCreate    replicaset/controller-868bf4c94d   Created pod: controller-868bf4c94d-dtnmn
70s         Normal   ScalingReplicaSet   deployment/controller              Scaled up replica set controller-868bf4c94d to 1
70s         Normal   Scheduled           pod/speaker-hb6ms                  Successfully assigned metallb-system/speaker-hb6ms to kates-node-02
70s         Normal   Pulling             pod/speaker-hb6ms                  Pulling image "quay.io/metallb/speaker:v0.12.1"
60s         Normal   Pulled              pod/speaker-hb6ms                  Successfully pulled image "quay.io/metallb/speaker:v0.12.1" in 9.820655993s
60s         Normal   Created             pod/speaker-hb6ms                  Created container speaker
60s         Normal   Started             pod/speaker-hb6ms                  Started container speaker
70s         Normal   Scheduled           pod/speaker-j5gpn                  Successfully assigned metallb-system/speaker-j5gpn to kates-node-01
70s         Normal   Pulling             pod/speaker-j5gpn                  Pulling image "quay.io/metallb/speaker:v0.12.1"
59s         Normal   Pulled              pod/speaker-j5gpn                  Successfully pulled image "quay.io/metallb/speaker:v0.12.1" in 10.835647902s
59s         Normal   Created             pod/speaker-j5gpn                  Created container speaker
59s         Normal   Started             pod/speaker-j5gpn                  Started container speaker
70s         Normal   Scheduled           pod/speaker-z9qqw                  Successfully assigned metallb-system/speaker-z9qqw to kates-control
70s         Normal   Pulling             pod/speaker-z9qqw                  Pulling image "quay.io/metallb/speaker:v0.12.1"
59s         Normal   Pulled              pod/speaker-z9qqw                  Successfully pulled image "quay.io/metallb/speaker:v0.12.1" in 11.068649905s
59s         Normal   Created             pod/speaker-z9qqw                  Created container speaker
59s         Normal   Started             pod/speaker-z9qqw                  Started container speaker
70s         Normal   SuccessfulCreate    daemonset/speaker                  Created pod: speaker-z9qqw
70s         Normal   SuccessfulCreate    daemonset/speaker                  Created pod: speaker-j5gpn
70s         Normal   SuccessfulCreate    daemonset/speaker                  Created pod: speaker-hb6ms


ubuntu@kates-control:~$ kubectl get all -n metallb-system
NAME                              READY   STATUS    RESTARTS   AGE
pod/controller-868bf4c94d-qllcz   1/1     Running   0          39s
pod/speaker-2dpxw                 1/1     Running   0          39s
pod/speaker-5qgm9                 1/1     Running   0          39s

NAME                     DESIRED   CURRENT   READY   UP-TO-DATE   AVAILABLE   NODE SELECTOR            AGE
daemonset.apps/speaker   2         2         2       2            2           kubernetes.io/os=linux   39s

NAME                         READY   UP-TO-DATE   AVAILABLE   AGE
deployment.apps/controller   1/1     1            1           39s

NAME                                    DESIRED   CURRENT   READY   AGE
replicaset.apps/controller-868bf4c94d   1         1         1       39s

```
Finally we need a configmap with an ip range to assign addresses from out local network.
```bash
ubuntu@kates-control:~$ cat > ./metallb-configmap.yaml << EOF
> apiVersion: v1
> kind: ConfigMap
> metadata:
>   namespace: metallb-system
>   name: config
> data:
>   config: |
>    address-pools:
>     - name: default
>       protocol: layer2
>       addresses:
>       - 192.168.1.50 - 192.168.1.99
>
> EOF

ubuntu@kates-control:~$ kubectl apply -f metallb-configmap.yaml
configmap/config created

ubuntu@kates-control:~$ kubectl get cm -n metallb-system
NAME               DATA   AGE
config             1      13s
kube-root-ca.crt   1      4m16s
```

___
### Use KNE to create a basic topology
___
Okay now! Let pick a simple sample lab with two linux nodes and spin it up.

```bash
ubuntu@kates-control:~$ kne_cli create kne/examples/2node-host.pb.txt
INFO[0000] /home/ubuntu/kne/examples
INFO[0000] Creating manager for: 2node-host
INFO[0000] Trying in-cluster configuration
INFO[0000] Falling back to kubeconfig: "/home/ubuntu/.kube/config"
INFO[0000] Topology:
name: "2node-host"
nodes: <
  name: "vm-1"
  type: HOST
  config: <
    image: "hfam/ubuntu:latest"
  >
>
nodes: <
  name: "vm-2"
  type: HOST
>
links: <
  a_node: "vm-1"
  a_int: "eth1"
  z_node: "vm-2"
  z_int: "eth1"
>

INFO[0000] Adding Link: vm-1:eth1 vm-2:eth1
INFO[0000] Adding Node: vm-1:UNKNOWN:HOST
INFO[0000] Adding Node: vm-2:UNKNOWN:HOST
INFO[0000] Creating namespace for topology: "2node-host"
INFO[0000] Server Namespace: &Namespace{ObjectMeta:{2node-host    13677a1e-f4fc-42cc-bee8-4484107facb6 139020 0 2022-06-01 13:29:27 +0000 UTC <nil> <nil> map[kubernetes.io/metadata.name:2node-host] map[] [] []  [{kne_cli Update v1 2022-06-01 13:29:27 +0000 UTC FieldsV1 {"f:metadata":{"f:labels":{".":{},"f:kubernetes.io/metadata.name":{}}}} }]},Spec:NamespaceSpec{Finalizers:[kubernetes],},Status:NamespaceStatus{Phase:Active,Conditions:[]NamespaceCondition{},},}
INFO[0000] Getting topology specs for namespace 2node-host
INFO[0000] Getting topology specs for node vm-1
INFO[0000] Getting topology specs for node vm-2
INFO[0000] Creating topology for meshnet node vm-2
INFO[0000] Meshnet Node:
&{TypeMeta:{Kind: APIVersion:} ObjectMeta:{Name:vm-2 GenerateName: Namespace:2node-host SelfLink: UID:b6de0742-35e3-478b-8c40-e7b6f59dc8bf ResourceVersion:139023 Generation:1 CreationTimestamp:2022-06-01 13:29:27 +0000 UTC DeletionTimestamp:<nil> DeletionGracePeriodSeconds:<nil> Labels:map[] Annotations:map[] OwnerReferences:[] Finalizers:[] ZZZ_DeprecatedClusterName: ManagedFields:[{Manager:kne_cli Operation:Update APIVersion:networkop.co.uk/v1beta1 Time:2022-06-01 13:29:27 +0000 UTC FieldsType:FieldsV1 FieldsV1:{"f:spec":{".":{},"f:links":{}}} Subresource:}]} Status:{TypeMeta:{Kind: APIVersion:} ObjectMeta:{Name: GenerateName: Namespace: SelfLink: UID: ResourceVersion: Generation:0 CreationTimestamp:0001-01-01 00:00:00 +0000 UTC DeletionTimestamp:<nil> DeletionGracePeriodSeconds:<nil> Labels:map[] Annotations:map[] OwnerReferences:[] Finalizers:[] ZZZ_DeprecatedClusterName: ManagedFields:[]} Skipped:[] SrcIp: NetNs:} Spec:{TypeMeta:{Kind: APIVersion:} Links:[{LocalIntf:eth1 LocalIP: PeerIntf:eth1 PeerIP: PeerPod:vm-1 UID:0}]}}
INFO[0000] Creating topology for meshnet node vm-1
INFO[0000] Meshnet Node:
&{TypeMeta:{Kind: APIVersion:} ObjectMeta:{Name:vm-1 GenerateName: Namespace:2node-host SelfLink: UID:140df03a-15a1-44fe-a57f-47d464f8b9fc ResourceVersion:139024 Generation:1 CreationTimestamp:2022-06-01 13:29:27 +0000 UTC DeletionTimestamp:<nil> DeletionGracePeriodSeconds:<nil> Labels:map[] Annotations:map[] OwnerReferences:[] Finalizers:[] ZZZ_DeprecatedClusterName: ManagedFields:[{Manager:kne_cli Operation:Update APIVersion:networkop.co.uk/v1beta1 Time:2022-06-01 13:29:27 +0000 UTC FieldsType:FieldsV1 FieldsV1:{"f:spec":{".":{},"f:links":{}}} Subresource:}]} Status:{TypeMeta:{Kind: APIVersion:} ObjectMeta:{Name: GenerateName: Namespace: SelfLink: UID: ResourceVersion: Generation:0 CreationTimestamp:0001-01-01 00:00:00 +0000 UTC DeletionTimestamp:<nil> DeletionGracePeriodSeconds:<nil> Labels:map[] Annotations:map[] OwnerReferences:[] Finalizers:[] ZZZ_DeprecatedClusterName: ManagedFields:[]} Skipped:[] SrcIp: NetNs:} Spec:{TypeMeta:{Kind: APIVersion:} Links:[{LocalIntf:eth1 LocalIP: PeerIntf:eth1 PeerIP: PeerPod:vm-2 UID:0}]}}
INFO[0000] Creating Node Pods
INFO[0000] Creating Pod:
 name:"vm-1"  type:HOST  config:{command:"/bin/sh"  command:"-c"  command:"sleep 2000000000000"  image:"hfam/ubuntu:latest"  entry_command:"kubectl exec -it vm-1 -- sh"  config_path:"/etc"  config_file:"config"}  interfaces:{key:"eth1"  value:{int_name:"eth1"  peer_name:"vm-2"  peer_int_name:"eth1"}}
INFO[0000] no services found
INFO[0000] Node "vm-1" resource created
INFO[0000] Creating Pod:
 name:"vm-2"  type:HOST  config:{command:"/bin/sh"  command:"-c"  command:"sleep 2000000000000"  image:"alpine:latest"  entry_command:"kubectl exec -it vm-2 -- sh"  config_path:"/etc"  config_file:"config"}  interfaces:{key:"eth1"  value:{int_name:"eth1"  peer_name:"vm-1"  peer_int_name:"eth1"}}
INFO[0000] no services found
INFO[0000] Node "vm-2" resource created
INFO[0003] Node "vm-1": Status RUNNING
INFO[0003] Node "vm-2": Status RUNNING
INFO[0003] Topology "2node-host" created
Error: failed to check resource kne/examples/2node-host.pb.txt: could not get services for node vm-1: services "service-vm-1" not found
ubuntu@kates-control:~$
```
Let's look in k8s
```bash
ubuntu@kates-control:~$ kubectl get all -n 2node-host -owide
NAME       READY   STATUS    RESTARTS   AGE   IP               NODE            NOMINATED NODE   READINESS GATES
pod/vm-1   1/1     Running   0          55s   10.244.115.196   kates-node-01   <none>           <none>
pod/vm-2   1/1     Running   0          55s   10.244.209.195   kates-node-02   <none>           <none>

# Attach to the 1st device
ubuntu@kates-control:~$ kubectl exec -n 2node-host -it  pod/vm-1 -- bash
Defaulted container "vm-1" out of: vm-1, init-vm-1 (init)
root@vm-1:/#

root@vm-1:/# ip link
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
3: eth0@if26: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1450 qdisc noqueue state UP mode DEFAULT group default
    link/ether d6:75:2e:b9:44:e1 brd ff:ff:ff:ff:ff:ff link-netnsid 0
27: eth1@if27: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1450 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000
    link/ether 5e:02:2b:e4:66:b2 brd ff:ff:ff:ff:ff:ff link-netnsid 0
root@vm-1

# Configure an IP address on the adapter connected to the 2nd device
root@vm-1:/# ip add add 10.1.1.1/30 dev eth1
root@vm-1:/# exit
exit

# Attach to the 2nd device, do the same and verify that the ping is successful
ubuntu@kates-control:~$ kubectl exec -n 2node-host -it  pod/vm-2 -- sh
Defaulted container "vm-2" out of: vm-2, init-vm-2 (init)
/ #
/ # ip link
/ # ip add add 10.1.1.2/30 dev eth1
/ # ping 10.1.1.1
PING 10.1.1.1 (10.1.1.1): 56 data bytes
64 bytes from 10.1.1.1: seq=0 ttl=64 time=3.370 ms
64 bytes from 10.1.1.1: seq=1 ttl=64 time=1.082 ms
64 bytes from 10.1.1.1: seq=2 ttl=64 time=0.844 ms
64 bytes from 10.1.1.1: seq=3 ttl=64 time=1.001 ms
^C
--- 10.1.1.1 ping statistics ---
4 packets transmitted, 4 packets received, 0% packet loss
round-trip min/avg/max = 0.844/1.574/3.370 ms

# We are learning the MAC of the peer device
/ # ip nei
10.1.1.1 dev eth1 lladdr 5e:02:2b:e4:66:b2 ref 1 used 0/0/0 probes 4 REACHABLE
```
Seems working, right? :smile:
___
### Test Nokia srlinux
___
In order to use the srlinux container we need to have the srlinux controller installed in k8s.
```bash
ubuntu@kates-control:~$ kubectl apply -k https://github.com/srl-labs/srl-controller/config/default
namespace/srlinux-controller created
customresourcedefinition.apiextensions.k8s.io/srlinuxes.kne.srlinux.dev created
serviceaccount/srlinux-controller-controller-manager created
role.rbac.authorization.k8s.io/srlinux-controller-leader-election-role created
clusterrole.rbac.authorization.k8s.io/srlinux-controller-manager-role created
clusterrole.rbac.authorization.k8s.io/srlinux-controller-metrics-reader created
clusterrole.rbac.authorization.k8s.io/srlinux-controller-proxy-role created
rolebinding.rbac.authorization.k8s.io/srlinux-controller-leader-election-rolebinding created
clusterrolebinding.rbac.authorization.k8s.io/srlinux-controller-manager-rolebinding created
clusterrolebinding.rbac.authorization.k8s.io/srlinux-controller-proxy-rolebinding created
configmap/srlinux-controller-manager-config created
service/srlinux-controller-controller-manager-metrics-service created
deployment.apps/srlinux-controller-controller-manager created

ubuntu@kates-control:~$ kubectl get all -n srlinux-controller

NAME                                                         READY   STATUS    RESTARTS   AGE
pod/srlinux-controller-controller-manager-69f6579c6f-skg2j   2/2     Running   0          40s

NAME                                                            TYPE        CLUSTER-IP       EXTERNAL-IP   PORT(S)    AGE
service/srlinux-controller-controller-manager-metrics-service   ClusterIP   10.100.185.117   <none>        8443/TCP   40s

NAME                                                    READY   UP-TO-DATE   AVAILABLE   AGE
deployment.apps/srlinux-controller-controller-manager   1/1     1            1           40s

NAME                                                               DESIRED   CURRENT   READY   AGE
replicaset.apps/srlinux-controller-controller-manager-69f6579c6f   1         1         1       40s


ubuntu@kates-control:~$ kubectl get events -n srlinux-controller
LAST SEEN   TYPE     REASON              OBJECT                                                        MESSAGE
49s         Normal   LeaderElection      configmap/8bce046c.srlinux.dev                                srlinux-controller-controller-manager-69f6579c6f-skg2j_9e9d41e6-e29c-4abd-849f-39fd019eca72 became leader
49s         Normal   LeaderElection      lease/8bce046c.srlinux.dev                                    srlinux-controller-controller-manager-69f6579c6f-skg2j_9e9d41e6-e29c-4abd-849f-39fd019eca72 became leader
62s         Normal   Scheduled           pod/srlinux-controller-controller-manager-69f6579c6f-skg2j    Successfully assigned srlinux-controller/srlinux-controller-controller-manager-69f6579c6f-skg2j to kates-node-02
61s         Normal   Pulling             pod/srlinux-controller-controller-manager-69f6579c6f-skg2j    Pulling image "gcr.io/kubebuilder/kube-rbac-proxy:v0.8.0"
57s         Normal   Pulled              pod/srlinux-controller-controller-manager-69f6579c6f-skg2j    Successfully pulled image "gcr.io/kubebuilder/kube-rbac-proxy:v0.8.0" in 4.485800395s
57s         Normal   Created             pod/srlinux-controller-controller-manager-69f6579c6f-skg2j    Created container kube-rbac-proxy
57s         Normal   Started             pod/srlinux-controller-controller-manager-69f6579c6f-skg2j    Started container kube-rbac-proxy
57s         Normal   Pulling             pod/srlinux-controller-controller-manager-69f6579c6f-skg2j    Pulling image "ghcr.io/srl-labs/srl-controller:0.3.1"
53s         Normal   Pulled              pod/srlinux-controller-controller-manager-69f6579c6f-skg2j    Successfully pulled image "ghcr.io/srl-labs/srl-controller:0.3.1" in 4.313788546s
52s         Normal   Created             pod/srlinux-controller-controller-manager-69f6579c6f-skg2j    Created container manager
52s         Normal   Started             pod/srlinux-controller-controller-manager-69f6579c6f-skg2j    Started container manager
62s         Normal   SuccessfulCreate    replicaset/srlinux-controller-controller-manager-69f6579c6f   Created pod: srlinux-controller-controller-manager-69f6579c6f-skg2j
62s         Normal   ScalingReplicaSet   deployment/srlinux-controller-controller-manager              Scaled up replica set srlinux-controller-controller-manager-69f6579c6f to 1

```
Deploy a sample topology using KNEs sample topologies files.
```bash
ubuntu@kates-control:~$ cat kne/examples/srlinux/2node-srl-with-cert.pbtxt
name: "2srl-certs"
nodes: {
    name: "r1"
    type: NOKIA_SRL
    config: {
        cert: {
            self_signed: {
                cert_name: "kne-profile",
                key_name: "N/A",
                key_size: 4096,
            }
        }
    }
    services:{
        key: 22
        value: {
            name: "ssh"
            inside: 22
        }
    }
    services:{
        key: 57400
        value: {
            name: "gnmi"
            inside: 57400
        }
    }
}
nodes: {
    name: "r2"
    type: NOKIA_SRL
    config: {
        cert: {
            self_signed: {
                cert_name: "kne-profile",
                key_name: "N/A",
                key_size: 4096,
            }
        }
    }
    services:{
        key: 22
        value: {
            name: "ssh"
            inside: 22
        }
    }
}

links: {
    a_node: "r1"
    a_int: "e1-1"
    z_node: "r2"
    z_int: "e1-1"
}
```
Create the topology with 2 SR linux devices.
```bash
ubuntu@kates-control:~$ kne_cli create kne/examples/srlinux/2node-srl-with-cert.pbtxt
INFO[0000] /home/ubuntu/kne/examples/srlinux
INFO[0000] Creating manager for: 2srl-certs
INFO[0000] Trying in-cluster configuration
INFO[0000] Falling back to kubeconfig: "/home/ubuntu/.kube/config"
INFO[0000] Topology:
name: "2srl-certs"
nodes: <
  name: "r1"
  type: NOKIA_SRL
  config: <
    cert: <
      self_signed: <
        cert_name: "kne-profile"
        key_name: "N/A"
        key_size: 4096
      >
    >
  >
  services: <
    key: 22
    value: <
      name: "ssh"
      inside: 22
    >
  >
  services: <
    key: 57400
    value: <
      name: "gnmi"
      inside: 57400
    >
  >
>
nodes: <
  name: "r2"
  type: NOKIA_SRL
  config: <
    cert: <
      self_signed: <
        cert_name: "kne-profile"
        key_name: "N/A"
        key_size: 4096
      >
    >
  >
  services: <
    key: 22
    value: <
      name: "ssh"
      inside: 22
    >
  >
>
links: <
  a_node: "r1"
  a_int: "e1-1"
  z_node: "r2"
  z_int: "e1-1"
>

INFO[0000] Adding Link: r1:e1-1 r2:e1-1
INFO[0000] Adding Node: r1:UNKNOWN:NOKIA_SRL
INFO[0000] Adding Node: r2:UNKNOWN:NOKIA_SRL
INFO[0000] Creating namespace for topology: "2srl-certs"
INFO[0000] Server Namespace: &Namespace{ObjectMeta:{2srl-certs    3dbfff65-53fe-430a-b4a5-1d8f364b598c 9092 0 2022-06-03 21:30:30 +0000 UTC <nil> <nil> map[kubernetes.io/metadata.name:2srl-certs] map[] [] []  [{kne_cli Update v1 2022-06-03 21:30:30 +0000 UTC FieldsV1 {"f:metadata":{"f:labels":{".":{},"f:kubernetes.io/metadata.name":{}}}}}]},Spec:NamespaceSpec{Finalizers:[kubernetes],},Status:NamespaceStatus{Phase:Active,Conditions:[]NamespaceCondition{},},}
INFO[0000] Getting topology specs for namespace 2srl-certs
INFO[0000] Getting topology specs for node r1
INFO[0000] Getting topology specs for node r2
INFO[0000] Creating topology for meshnet node r2
INFO[0000] Meshnet Node:
&{TypeMeta:{Kind: APIVersion:} ObjectMeta:{Name:r2 GenerateName: Namespace:2srl-certs SelfLink: UID:45c4a20d-a803-491d-8a78-9a75603e3f1a ResourceVersion:9095 Generation:1 CreationTimestamp:2022-06-03 21:30:30 +0000 UTC DeletionTimestamp:<nil> DeletionGracePeriodSeconds:<nil> Labels:map[] Annotations:map[] OwnerReferences:[] Finalizers:[] ClusterName: ManagedFields:[{Manager:kne_cli Operation:Update APIVersion:networkop.co.uk/v1beta1 Time:2022-06-03 21:30:30 +0000 UTC FieldsType:FieldsV1 FieldsV1:{"f:spec":{".":{},"f:links":{}}}}]} Status:{TypeMeta:{Kind: APIVersion:} ObjectMeta:{Name: GenerateName: Namespace: SelfLink: UID: ResourceVersion: Generation:0 CreationTimestamp:0001-01-01 00:00:00 +0000 UTC DeletionTimestamp:<nil> DeletionGracePeriodSeconds:<nil> Labels:map[] Annotations:map[] OwnerReferences:[] Finalizers:[] ClusterName: ManagedFields:[]} Skipped:[] SrcIp: NetNs:} Spec:{TypeMeta:{Kind: APIVersion:} Links:[{LocalIntf:e1-1 LocalIP: PeerIntf:e1-1 PeerIP: PeerPod:r1 UID:0}]}}
INFO[0000] Creating topology for meshnet node r1
INFO[0000] Meshnet Node:
&{TypeMeta:{Kind: APIVersion:} ObjectMeta:{Name:r1 GenerateName: Namespace:2srl-certs SelfLink: UID:bda477bd-f318-4a3d-ba2a-a7688c60716b ResourceVersion:9096 Generation:1 CreationTimestamp:2022-06-03 21:30:30 +0000 UTC DeletionTimestamp:<nil> DeletionGracePeriodSeconds:<nil> Labels:map[] Annotations:map[] OwnerReferences:[] Finalizers:[] ClusterName: ManagedFields:[{Manager:kne_cli Operation:Update APIVersion:networkop.co.uk/v1beta1 Time:2022-06-03 21:30:30 +0000 UTC FieldsType:FieldsV1 FieldsV1:{"f:spec":{".":{},"f:links":{}}}}]} Status:{TypeMeta:{Kind: APIVersion:} ObjectMeta:{Name: GenerateName: Namespace: SelfLink: UID: ResourceVersion: Generation:0 CreationTimestamp:0001-01-01 00:00:00 +0000 UTC DeletionTimestamp:<nil> DeletionGracePeriodSeconds:<nil> Labels:map[] Annotations:map[] OwnerReferences:[] Finalizers:[] ClusterName: ManagedFields:[]} Skipped:[] SrcIp: NetNs:} Spec:{TypeMeta:{Kind: APIVersion:} Links:[{LocalIntf:e1-1 LocalIP: PeerIntf:e1-1 PeerIP: PeerPod:r2 UID:0}]}}
INFO[0000] Creating Node Pods
INFO[0000] Creating Srlinux node resource r1
INFO[0000] Created SR Linux node r1 configmap
INFO[0000] Created Srlinux resource: r1
INFO[0000] Created Service:
&Service{ObjectMeta:{service-r1  2srl-certs  776a3f25-05bd-483e-9947-2800efa8e796 9111 0 2022-06-03 21:30:31 +0000 UTC <nil> <nil> map[pod:r1] map[] [] []  [{kne_cli Update v1 2022-06-03 21:30:31 +0000 UTC FieldsV1 {"f:metadata":{"f:labels":{".":{},"f:pod":{}}},"f:spec":{"f:allocateLoadBalancerNodePorts":{},"f:externalTrafficPolicy":{},"f:internalTrafficPolicy":{},"f:ports":{".":{},"k:{\"port\":22,\"protocol\":\"TCP\"}":{".":{},"f:name":{},"f:port":{},"f:protocol":{},"f:targetPort":{}},"k:{\"port\":57400,\"protocol\":\"TCP\"}":{".":{},"f:name":{},"f:port":{},"f:protocol":{},"f:targetPort":{}}},"f:selector":{},"f:sessionAffinity":{},"f:type":{}}}}]},Spec:ServiceSpec{Ports:[]ServicePort{ServicePort{Name:ssh,Protocol:TCP,Port:22,TargetPort:{0 22 },NodePort:30742,AppProtocol:nil,},ServicePort{Name:gnmi,Protocol:TCP,Port:57400,TargetPort:{0 57400 },NodePort:30637,AppProtocol:nil,},},Selector:map[string]string{app: r1,},ClusterIP:10.103.94.50,Type:LoadBalancer,ExternalIPs:[],SessionAffinity:None,LoadBalancerIP:,LoadBalancerSourceRanges:[],ExternalName:,ExternalTrafficPolicy:Cluster,HealthCheckNodePort:0,PublishNotReadyAddresses:false,SessionAffinityConfig:nil,TopologyKeys:[],IPFamilyPolicy:*SingleStack,ClusterIPs:[10.103.94.50],IPFamilies:[IPv4],AllocateLoadBalancerNodePorts:*true,LoadBalancerClass:nil,InternalTrafficPolicy:*Cluster,},Status:ServiceStatus{LoadBalancer:LoadBalancerStatus{Ingress:[]LoadBalancerIngress{},},Conditions:[]Condition{},},}
INFO[0000] Node "r1" resource created
INFO[0000] Creating Srlinux node resource r2
INFO[0000] Created SR Linux node r2 configmap
INFO[0001] Created Srlinux resource: r2
INFO[0001] Created Service:
&Service{ObjectMeta:{service-r2  2srl-certs  09c1e6e0-0c19-4497-b133-d2b2fa22d20d 9126 0 2022-06-03 21:30:31 +0000 UTC <nil> <nil> map[pod:r2] map[] [] []  [{kne_cli Update v1 2022-06-03 21:30:31 +0000 UTC FieldsV1 {"f:metadata":{"f:labels":{".":{},"f:pod":{}}},"f:spec":{"f:allocateLoadBalancerNodePorts":{},"f:externalTrafficPolicy":{},"f:internalTrafficPolicy":{},"f:ports":{".":{},"k:{\"port\":22,\"protocol\":\"TCP\"}":{".":{},"f:name":{},"f:port":{},"f:protocol":{},"f:targetPort":{}}},"f:selector":{},"f:sessionAffinity":{},"f:type":{}}}}]},Spec:ServiceSpec{Ports:[]ServicePort{ServicePort{Name:ssh,Protocol:TCP,Port:22,TargetPort:{0 22 },NodePort:32417,AppProtocol:nil,},},Selector:map[string]string{app: r2,},ClusterIP:10.111.173.232,Type:LoadBalancer,ExternalIPs:[],SessionAffinity:None,LoadBalancerIP:,LoadBalancerSourceRanges:[],ExternalName:,ExternalTrafficPolicy:Cluster,HealthCheckNodePort:0,PublishNotReadyAddresses:false,SessionAffinityConfig:nil,TopologyKeys:[],IPFamilyPolicy:*SingleStack,ClusterIPs:[10.111.173.232],IPFamilies:[IPv4],AllocateLoadBalancerNodePorts:*true,LoadBalancerClass:nil,InternalTrafficPolicy:*Cluster,},Status:ServiceStatus{LoadBalancer:LoadBalancerStatus{Ingress:[]LoadBalancerIngress{},},Conditions:[]Condition{},},}

INFO[0001] Node "r2" resource created
INFO[0001] r1 - generating self signed certs
INFO[0001] r1 - waiting for pod to be running
INFO[0003] r1 - pod running.
INFO[0018] r1 - finshed cert generation
INFO[0018] r2 - generating self signed certs
INFO[0018] r2 - waiting for pod to be running
INFO[0018] r2 - pod running.
INFO[0021] r2 - finshed cert generation
INFO[0022] Node "r1": Status RUNNING
INFO[0022] Node "r2": Status RUNNING
INFO[0022] Topology "2srl-certs" created
INFO[0022] Pods:
INFO[0022] r1
INFO[0022] r2
```
Now, it may take some time for the last command to complete since it is fetching the images as well. Let's check on k8s.
```bash {hl_lines=["7-8"]}
ubuntu@kates-control:~$ kubectl get all -n 2srl-certs
NAME     READY   STATUS    RESTARTS   AGE
pod/r1   1/1     Running   0          23m
pod/r2   1/1     Running   0          23m

NAME                 TYPE           CLUSTER-IP       EXTERNAL-IP    PORT(S)                        AGE
service/service-r1   LoadBalancer   10.103.94.50     192.168.1.50   22:30742/TCP,57400:30637/TCP   23m
service/service-r2   LoadBalancer   10.111.173.232   192.168.1.51   22:32417/TCP                   23m

ubuntu@kates-control:~$ kubectl get events  -n 2srl-certs
LAST SEEN   TYPE     REASON         OBJECT               MESSAGE
23m         Normal   Scheduled      pod/r1               Successfully assigned 2srl-certs/r1 to kates-node-02
23m         Normal   Pulled         pod/r1               Container image "networkop/init-wait:latest" already present on machine
23m         Normal   Created        pod/r1               Created container init-r1
23m         Normal   Started        pod/r1               Started container init-r1
23m         Normal   Pulled         pod/r1               Container image "ghcr.io/nokia/srlinux:latest" already present on machine
23m         Normal   Created        pod/r1               Created container r1
23m         Normal   Started        pod/r1               Started container r1
23m         Normal   Scheduled      pod/r2               Successfully assigned 2srl-certs/r2 to kates-node-01
23m         Normal   Pulled         pod/r2               Container image "networkop/init-wait:latest" already present on machine
23m         Normal   Created        pod/r2               Created container init-r2
23m         Normal   Started        pod/r2               Started container init-r2
23m         Normal   Pulled         pod/r2               Container image "ghcr.io/nokia/srlinux:latest" already present on machine
23m         Normal   Created        pod/r2               Created container r2
23m         Normal   Started        pod/r2               Started container r2
23m         Normal   IPAllocated    service/service-r1   Assigned IP ["192.168.1.50"]
23m         Normal   nodeAssigned   service/service-r1   announcing from node "kates-node-01"
23m         Normal   IPAllocated    service/service-r2   Assigned IP ["192.168.1.51"]
23m         Normal   nodeAssigned   service/service-r2   announcing from node "kates-node-02"
```
It looks good. From another terminal you can access the devices via SSH to the service IP assigned (admin:admin are the credentials).
```bash
❯ ssh admin@192.168.1.50
The authenticity of host '192.168.1.50 (192.168.1.50)' can't be established.
ECDSA key fingerprint is SHA256:cJwi5r4UVEVYEX9IAqrThzCrIQUYRRk3y5i5Lnw5hPE.
Are you sure you want to continue connecting (yes/no/[fingerprint])? yes
Warning: Permanently added '192.168.1.50' (ECDSA) to the list of known hosts.
admin@192.168.1.50's password:
Using configuration file(s): ['/etc/opt/srlinux/srlinux.rc']
Welcome to the srlinux CLI.
Type 'help' (and press <ENTER>) if you need any help using this.
--{ running }--[  ]--
A:r1#
A:r1# show interface brief
+---------------------+---------------+---------------+---------------+---------------+
|        Port         |  Admin State  |  Oper State   |     Speed     |     Type      |
+=====================+===============+===============+===============+===============+
| mgmt0               | enable        | down          |               |               |
+---------------------+---------------+---------------+---------------+---------------+
--{ running }--[  ]--
A:r1#
```
Hmmm, something is wrong here. We were supposed to get a bunch of interfaces, instead we got only mgmt0 and it is down.
Let's attach to the device shell and check the interfaces with some pings
```bash
ubuntu@kates-control:~$ kubectl -n 2srl-certs exec -it r1 -- bash
Defaulted container "r1" out of: r1, init-r1 (init)
[root@r1 /]#
[root@r1 /]# ip link
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
3: mgmt0@if6: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1450 qdisc noqueue state UP mode DEFAULT group default
    link/ether 82:98:bc:94:f1:94 brd ff:ff:ff:ff:ff:ff link-netnsid 0
4: gway-2800@if2: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP mode DEFAULT group default qlen 1000
    link/ether be:75:15:da:44:66 brd ff:ff:ff:ff:ff:ff link-netns srbase-mgmt
7: e1-1@if7: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1450 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000
    link/ether f6:96:83:ff:1f:db brd ff:ff:ff:ff:ff:ff link-netnsid 0

[root@r1 /]# ip add
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
    inet 127.0.0.1/8 scope host lo
       valid_lft forever preferred_lft forever
    inet6 ::1/128 scope host
       valid_lft forever preferred_lft forever
3: mgmt0@if6: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1450 qdisc noqueue state UP group default
    link/ether 82:98:bc:94:f1:94 brd ff:ff:ff:ff:ff:ff link-netnsid 0
    inet 10.244.2.53/24 brd 10.244.2.255 scope global eth0
       valid_lft forever preferred_lft forever
    inet6 fe80::8098:bcff:fe94:f194/64 scope link
       valid_lft forever preferred_lft forever
4: gway-2800@if2: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP group default qlen 1000
    link/ether be:75:15:da:44:66 brd ff:ff:ff:ff:ff:ff link-netns srbase-mgmt
    inet6 fe80::bc75:15ff:feda:4466/64 scope link
       valid_lft forever preferred_lft forever
7: e1-1@if7: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1450 qdisc noqueue state UNKNOWN group default qlen 1000
    link/ether f6:96:83:ff:1f:db brd ff:ff:ff:ff:ff:ff link-netnsid 0
    inet6 fe80::f496:83ff:feff:1fdb/64 scope link
       valid_lft forever preferred_lft forever

[root@r1 /]# ip add add 10.1.1.1/30 dev e1-1
[root@r1 /]# exit
exit

ubuntu@kates-control:~$ kubectl -n 2srl-certs exec -it r2 -- bash
Defaulted container "r2" out of: r2, init-r2 (init)
[root@r2 /]#
[root@r2 /]#
[root@r2 /]# ip add add 10.1.1.2/30 dev e1-1
[root@r2 /]# ping 10.1.1.1
PING 10.1.1.1 (10.1.1.1) 56(84) bytes of data.
64 bytes from 10.1.1.1: icmp_seq=1 ttl=64 time=1.99 ms
64 bytes from 10.1.1.1: icmp_seq=2 ttl=64 time=0.804 ms
64 bytes from 10.1.1.1: icmp_seq=3 ttl=64 time=0.678 ms
64 bytes from 10.1.1.1: icmp_seq=4 ttl=64 time=0.959 ms
^C
--- 10.1.1.1 ping statistics ---
4 packets transmitted, 4 received, 0% packet loss, time 3052ms
rtt min/avg/max/mdev = 0.678/1.108/1.992/0.520 ms
```
Seems PODs are communicating fine, and I guess the issues is with the router itself, or should I say the container :smile:. Let's check some logs.
```bash
ubuntu@kates-control:~$ kubectl -n 2srl-certs describe pod/r1
< ...omitted...>
Events:
  Type    Reason     Age   From               Message
  ----    ------     ----  ----               -------
  Normal  Scheduled  36m   default-scheduler  Successfully assigned 2srl-certs/r1 to kates-node-02
  Normal  Pulled     36m   kubelet            Container image "networkop/init-wait:latest" already present on machine
  Normal  Created    36m   kubelet            Created container init-r1
  Normal  Started    36m   kubelet            Started container init-r1
  Normal  Pulled     36m   kubelet            Container image "ghcr.io/nokia/srlinux:latest" already present on machine
  Normal  Created    36m   kubelet            Created container r1
  Normal  Started    36m   kubelet            Started container r1

# Check to see the boot up logs
ubuntu@kates-control:~$ kubectl -n 2srl-certs logs r1
Defaulted container "r1" out of: r1, init-r1 (init)
Fri Jun  3 21:30:33 UTC 2022: entrypoint.sh called
Fri Jun  3 21:30:33 UTC 2022: renaming docker interface eth0 to mgmt0
Fri Jun  3 21:30:33 UTC 2022: turning off checksum offloading on mgmt0
Actual changes:
rx-checksumming: off
tx-checksumming: off
        tx-checksum-ip-generic: off
        tx-checksum-sctp: off
tcp-segmentation-offload: off
        tx-tcp-segmentation: off [requested on]
        tx-tcp-ecn-segmentation: off [requested on]
        tx-tcp-mangleid-segmentation: off [requested on]
        tx-tcp6-segmentation: off [requested on]
Fri Jun  3 21:30:33 UTC 2022: starting sshd
ssh-keygen: generating new host keys: RSA DSA ECDSA ED25519
Fri Jun  3 21:30:33 UTC 2022: Calling boot_run script
cat: /sys/class/dmi/id/board_name: No such file or directory
cat: /sys/class/dmi/id/board_name: No such file or directory
/opt/srlinux/bin/bootscript/05_sr_createuser.sh: line 270: !srl_is_running_on_nokia_rootfs: command not found
/opt/srlinux/bin/bootscript/05_sr_createuser.sh: line 282: python: command not found
chmod: cannot access '/dev/console': No such file or directory
chmod: missing operand after '0664'
Try 'chmod --help' for more information.
/usr/bin/find: '/var/log/srlinux/file': No such file or directory
logmgr_set_env.sh: plain_bootup_start
Fri Jun  3 21:30:35 UTC 2022  logmgr_set_env.sh: restart of rsyslogd
which: no python in (/opt/srlinux/bin:/opt/srlinux/usr/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin)
readlink: missing operand
Try 'readlink --help' for more information.
setfacl: /mnt/nokiaos: No such file or directory
setfacl: /mnt/nokiaos: No such file or directory
setfacl: /mnt/nokiaos: No such file or directory
setfacl: /mnt/nokiaos: No such file or directory
setfacl: Option -m: Invalid argument near character 5
setfacl: Option -m: Invalid argument near character 3
setfacl: Option -m: Invalid argument near character 5
setfacl: Option -m: Invalid argument near character 3
System has not been booted with systemd as init system (PID 1). Can't operate.
Failed to connect to bus: Host is down
Failed to open connection to "system" message bus: Failed to connect to socket /run/dbus/system_bus_socket: No such file or directory
System has not been booted with systemd as init system (PID 1). Can't operate.
Failed to connect to bus: Host is down
findfs: unable to resolve 'LABEL=EFI-System'
No disk with label EFI-System is found
Failed to set capabilities on file `/usr/sbin/tcpdump' (No such file or directory)
usage: setcap [-q] [-v] [-n <rootid>] (-r|-|<caps>) <filename> [ ... (-r|-|<capsN>) <filenameN> ]

 Note <filename> must be a regular (non-symlink) file.
Fri Jun  3 21:30:37 UTC 2022: entrypoint.sh done, executing sudo bash -c touch /.dockerenv && /opt/srlinux/bin/sr_linux
No/Invalid license found!
Not starting in a named namespace, giving it the name "srbase"
Unix domain socket directory is /opt/srlinux/var/run/
Log directory is /var/log/srlinux/stdout
  Started supportd: source /etc/profile.d/sr_app_env.sh &>/dev/null; bash -c "./sr_supportd --server-mode" >/var/log/srlinux/stdout/supportd.log 2>&1 &
  Application supportd is running: PID 1525
  Started dev_mgr: source /etc/profile.d/sr_app_env.sh &>/dev/null; bash -c "./sr_device_mgr" >/var/log/srlinux/stdout/dev_mgr.log 2>&1 &
  Application dev_mgr is running: PID 1548
  Started idb_server: source /etc/profile.d/sr_app_env.sh &>/dev/null; bash -c "./sr_idb_server" >/var/log/srlinux/stdout/idb_server.log 2>&1 &
  Application idb_server is running: PID 1568
  Started aaa_mgr: source /etc/profile.d/sr_app_env.sh &>/dev/null; bash -c "./sr_aaa_mgr" >/var/log/srlinux/stdout/aaa_mgr.log 2>&1 &
  Started acl_mgr: source /etc/profile.d/sr_app_env.sh &>/dev/null; bash -c "./sr_acl_mgr" >/var/log/srlinux/stdout/acl_mgr.log 2>&1 &
  Started arp_nd_mgr: source /etc/profile.d/sr_app_env.sh &>/dev/null; bash -c "./sr_arp_nd_mgr" >/var/log/srlinux/stdout/arp_nd_mgr.log 2>&1 &
  Started chassis_mgr: source /etc/profile.d/sr_app_env.sh &>/dev/null; bash -c "./sr_chassis_mgr" >/var/log/srlinux/stdout/chassis_mgr.log 2>&1 &
  Started dhcp_client_mgr: source /etc/profile.d/sr_app_env.sh &>/dev/null; bash -c "./sr_dhcp_client_mgr" >/var/log/srlinux/stdout/dhcp_client_mgr.log 2>&1 &
  Started evpn_mgr: source /etc/profile.d/sr_app_env.sh &>/dev/null; bash -c "./sr_evpn_mgr" >/var/log/srlinux/stdout/evpn_mgr.log 2>&1 &
  Started fhs_mgr: source /etc/profile.d/sr_app_env.sh &>/dev/null; bash -c "./sr_fhs_mgr" >/var/log/srlinux/stdout/fhs_mgr.log 2>&1 &
  Started fib_mgr: source /etc/profile.d/sr_app_env.sh &>/dev/null; bash -c "./sr_fib_mgr" >/var/log/srlinux/stdout/fib_mgr.log 2>&1 &
  Started l2_mac_learn_mgr: source /etc/profile.d/sr_app_env.sh &>/dev/null; bash -c "./sr_l2_mac_learn_mgr" >/var/log/srlinux/stdout/l2_mac_learn_mgr.log 2>&1 &
  Started l2_mac_mgr: source /etc/profile.d/sr_app_env.sh &>/dev/null; bash -c "./sr_l2_mac_mgr" >/var/log/srlinux/stdout/l2_mac_mgr.log 2>&1 &
  Started lag_mgr: source /etc/profile.d/sr_app_env.sh &>/dev/null; bash -c "./sr_lag_mgr" >/var/log/srlinux/stdout/lag_mgr.log 2>&1 &
  Started linux_mgr: source /etc/profile.d/sr_app_env.sh &>/dev/null; bash -c "./sr_linux_mgr" >/var/log/srlinux/stdout/linux_mgr.log 2>&1 &
  Started log_mgr: source /etc/profile.d/sr_app_env.sh &>/dev/null; bash -c "./sr_log_mgr" >/var/log/srlinux/stdout/log_mgr.log 2>&1 &
  Started mcid_mgr: source /etc/profile.d/sr_app_env.sh &>/dev/null; bash -c "./sr_mcid_mgr" >/var/log/srlinux/stdout/mcid_mgr.log 2>&1 &
  Started mgmt_server: source /etc/profile.d/sr_app_env.sh &>/dev/null; bash -c "./sr_mgmt_server" >/var/log/srlinux/stdout/mgmt_server.log 2>&1 &
  Started net_inst_mgr: source /etc/profile.d/sr_app_env.sh &>/dev/null; bash -c "./sr_net_inst_mgr" >/var/log/srlinux/stdout/net_inst_mgr.log 2>&1 &
  Started sdk_mgr: source /etc/profile.d/sr_app_env.sh &>/dev/null; bash -c "./sr_sdk_mgr" >/var/log/srlinux/stdout/sdk_mgr.log 2>&1 &
  Started sflow_sample_mgr: source /etc/profile.d/sr_app_env.sh &>/dev/null; bash -c "./sr_sflow_sample_mgr" >/var/log/srlinux/stdout/sflow_sample_mgr.log 2>&1 &
  Started xdp_lc_1: source /etc/profile.d/sr_app_env.sh &>/dev/null; bash -c "exec -a sr_xdp_lc_1 ./sr_xdp_lc  --slot_num 1" >/var/log/srlinux/stdout/xdp_lc_1.log 2>&1 &
  Application aaa_mgr is running: PID 1582
  Application acl_mgr is running: PID 1593
  Application arp_nd_mgr is running: PID 1604
  Application chassis_mgr is running: PID 1615
  Application dhcp_client_mgr is running: PID 1627
  Application evpn_mgr is running: PID 1638
  Application fhs_mgr is running: PID 1649
  Application fib_mgr is running: PID 1662
  Application l2_mac_learn_mgr is running: PID 1673
  Application l2_mac_mgr is running: PID 1687
  Application lag_mgr is running: PID 1706
  Application linux_mgr is running: PID 1717
  Application log_mgr is running: PID 1728
  Application mcid_mgr is running: PID 1741
  Application mgmt_server is running: PID 1755
  Application net_inst_mgr is running: PID 1766
  Application sdk_mgr is running: PID 1777
  Application sflow_sample_mgr is running: PID 1787
  Application xdp_lc_1 is running: PID 1797
  Started xdp_lc_1: source /etc/profile.d/sr_app_env.sh &>/dev/null; bash -c "exec -a sr_xdp_lc_1 ./sr_xdp_lc  --slot_num 1" >/var/log/srlinux/stdout/xdp_lc_1.log 2>&1 &
  Application xdp_lc_1 is running: PID 2551
[/dev/console unavailable]: 22-06-03 21:30:55.343 sr_app_mgr: Would reboot with reason 'AppMgr: xdp_lc_1 has failed' but no-reboot is set
```
Well it took me some time to figure out that the last line was the indication that "xdp_lc_1" represents the process for the line card, i.e. all interfaces were missing.
Let's go into the device shell to check the mentioned log.
```bash
[root@r1 /]# cat /var/log/srlinux/stdout/xdp_lc_1.20220603_213042.log
ERROR: This system does not support "SSSE3".
Please check that RTE_MACHINE is set correctly.
EAL: FATAL: unsupported cpu type.
EAL: unsupported cpu type.
22-06-03 21:30:42.524202  1797 C common    dpdk.cc:925                    SRL_ASSERT_MSG  Termination handler
========= SRL_ASSERT_MSG in program: sr_xdp_lc_1 =========
=== At: /builds/sr/srlinux/srlutil/dpdk/dpdk.cc:925
=== Condition failed: ((diag > 0))
=== Cannot init DPDK EAL


 0x7a1bad, sr_xdp_lc_1 : srlinux::dpdk::Dpdk::InitEal()+0x159d
 0x7a1cb1, sr_xdp_lc_1 : srlinux::dpdk::Dpdk::Init()+0x11
 0x57c766, sr_xdp_lc_1 : main()+0x236
 0x7fc972aadca3, /lib64/libc.so.6 : __libc_start_main()+0xf3
 0x59268e, sr_xdp_lc_1 : _start()+0x2e
==============================
=== Program: sr_xdp_lc_1
/builds/sr/srlinux/srlutil/dpdk/dpdk.cc:925 | condition failed ((diag > 0)) | Cannot init DPDK EAL
```
After some googling around, It seems that SSSE3 is not there in the CPU.
```bash
ubuntu@kates-control:~$ lscpu
Architecture:                    x86_64
CPU op-mode(s):                  32-bit, 64-bit
Byte Order:                      Little Endian
Address sizes:                   40 bits physical, 48 bits virtual
CPU(s):                          8
On-line CPU(s) list:             0-7
Thread(s) per core:              1
Core(s) per socket:              1
Socket(s):                       8
NUMA node(s):                    1
Vendor ID:                       GenuineIntel
CPU family:                      6
Model:                           6
Model name:                      QEMU Virtual CPU version 2.5+
Stepping:                        3
CPU MHz:                         2496.000
BogoMIPS:                        4992.00
Hypervisor vendor:               KVM
Virtualization type:             full
L1d cache:                       256 KiB
L1i cache:                       256 KiB
L2 cache:                        32 MiB
L3 cache:                        128 MiB
NUMA node0 CPU(s):               0-7
Vulnerability Itlb multihit:     KVM: Vulnerable
Vulnerability L1tf:              Mitigation; PTE Inversion
Vulnerability Mds:               Vulnerable: Clear CPU buffers attempted, no microcode; SMT Host state unknown
Vulnerability Meltdown:          Mitigation; PTI
Vulnerability Spec store bypass: Vulnerable
Vulnerability Spectre v1:        Mitigation; usercopy/swapgs barriers and __user pointer sanitization
Vulnerability Spectre v2:        Mitigation; Retpolines, STIBP disabled, RSB filling
Vulnerability Srbds:             Not affected
Vulnerability Tsx async abort:   Not affected
Flags:                           fpu de pse tsc msr pae mce cx8 apic sep mtrr pge mca cmov pse36 clflush mmx fxsr sse sse2 syscall nx lm rep_good nopl xtopology cpuid tsc_known_freq pni cx16 x2apic hypervisor lahf_lm cpuid_fault pti
```
Let's check on EVE-NGs CPU because I don't think the processor is too old :smile:
```bash
root@eve-01:~# lscpu | grep Flags
Flags:                 fpu vme de pse tsc msr pae mce cx8 apic sep mtrr pge mca cmov pat pse36 clflush dts acpi mmx fxsr sse sse2 ss ht tm pbe syscall nx pdpe1gb rdtscp lm constant_tsc art arch_perfmon pebs bts rep_good nopl xtopology nonstop_tsc cpuid aperfmperf tsc_known_freq pni pclmulqdq dtes64 monitor ds_cpl vmx smx est tm2 ssse3 sdbg fma cx16 xtpr pdcm pcid sse4_1 sse4_2 x2apic movbe popcnt tsc_deadline_timer aes xsave avx f16c rdrand lahf_lm abm 3dnowprefetch cpuid_fault epb invpcid_single pti tpr_shadow vnmi flexpriority ept vpid ept_ad fsgsbase tsc_adjust bmi1 hle avx2 smep bmi2 erms invpcid rtm mpx rdseed adx smap clflushopt intel_pt xsaveopt xsavec xgetbv1 xsaves dtherm ida arat pln pts hwp hwp_notify hwp_act_window hwp_epp
```
So, it is there, but QEMU is not exposing it to the guest machines, which is an easy fix :smile: rather than deprecating the EVE-NGs. The fix is to append the parameters **-cpu qemu64,+ssse3,+sse4.1,+sse4.2** to the qemu command line for booting the VMs, but only after shutting down all 3 nodes to apply the change, as depicted below.

{{< image src="ssse3.png" caption="Missing CPU instruction set for SR Linux" width="400" >}}

Yet again if you want to make this the default for all linux VMs on your EVE-NG, you could append this to the template.
```bash
root@eve-01:~# cat /opt/unetlab/html/templates/intel/linux.yml | grep -v "#"
---
type: qemu
description: Linux
name: Linux
cpulimit: 1
icon: Server.png
cpu: 2
ram: 4096
ethernet: 1
console: vnc
shutdown: 1
qemu_arch: x86_64
qemu_version: 2.12.0
qemu_nic: virtio-net-pci
qemu_options: -machine type=pc,accel=kvm -vga virtio -usbdevice tablet -boot order=cd -cpu qemu64,+ssse3,+sse4.1,+sse4.2
...
```
After applying the "patch" and bringing up all nodes, everything should look better.
```bash
ubuntu@kates-control:~$ kubectl -n 2srl-certs get all
NAME     READY   STATUS    RESTARTS   AGE
pod/r1   1/1     Running   1          63m
pod/r2   1/1     Running   1          63m

NAME                 TYPE           CLUSTER-IP       EXTERNAL-IP    PORT(S)                        AGE
service/service-r1   LoadBalancer   10.103.94.50     192.168.1.50   22:30742/TCP,57400:30637/TCP   63m
service/service-r2   LoadBalancer   10.111.173.232   192.168.1.51   22:32417/TCP                   63m

ubuntu@kates-control:~$ ssh admin@192.168.1.50
admin@192.168.1.50's password:
Using configuration file(s): ['/etc/opt/srlinux/srlinux.rc']
Welcome to the srlinux CLI.
Type 'help' (and press <ENTER>) if you need any help using this.
--{ [FACTORY] running }--[  ]--
A:r1# show interface brief
+---------------------+-----------------------+-----------------------+-----------------------+-----------------------+
|        Port         |      Admin State      |      Oper State       |         Speed         |         Type          |
+=====================+=======================+=======================+=======================+=======================+
| ethernet-1/1        | disable               | down                  | 25G                   |                       |
| ethernet-1/2        | disable               | down                  | 25G                   |                       |
| ethernet-1/3        | disable               | down                  | 25G                   |                       |
| ethernet-1/4        | disable               | down                  | 25G                   |                       |
| ethernet-1/5        | disable               | down                  | 25G                   |                       |
| ethernet-1/6        | disable               | down                  | 25G                   |                       |
| ethernet-1/7        | disable               | down                  | 25G                   |                       |

< ...omitted... >

| ethernet-1/53       | disable               | down                  | 100G                  |                       |
| ethernet-1/54       | disable               | down                  | 100G                  |                       |
| ethernet-1/55       | disable               | down                  | 100G                  |                       |
| ethernet-1/56       | disable               | down                  | 100G                  |                       |
| mgmt0               | enable                | up                    | 1G                    |                       |
+---------------------+-----------------------+-----------------------+-----------------------+-----------------------+
```
We can now proceed with the ping testing, this time from within the box :smile:. Let's apply some configs on the interfaces.
```bash
A:r1# diff flat
insert / interface ethernet-1/1
insert / interface ethernet-1/1 admin-state enable
insert / interface ethernet-1/1 subinterface 0
insert / interface ethernet-1/1 subinterface 0 ipv4
insert / interface ethernet-1/1 subinterface 0 ipv4 address 10.1.1.1/30
insert / network-instance main
insert / network-instance main interface ethernet-1/1.0
A:r1# commit now
All changes have been committed. Leaving candidate mode.
--{ [FACTORY] + running }--[  ]--
A:r1# show interface ethernet-1/1
==========================================================================================================================
ethernet-1/1 is down, reason lower-layer-down
  ethernet-1/1.0 is down, reason port-down
    Network-instance: main
    Encapsulation   : null
    Type            : routed
    IPv4 addr    : 10.1.1.1/30 (static, None)
--------------------------------------------------------------------------------------------------------------------------
==========================================================================================================================
--{ [FACTORY] + candidate shared default }--[  ]--
A:r1#
```
I guess we still have a _lower layer_ problem. Let's get a shell into the box and check the logs.
```bash
ubuntu@kates-control:~$ kubectl -n 2srl-certs exec -it r1 -- bash
Defaulted container "r1" out of: r1, init-r1 (init)
[root@r1 /]# tail /var/log/messages
Jun  8 12:50:02 r1 sr_net_inst_mgr: netinst|1704|1704|00013|N: The interface mgmt0.0 in network-instance mgmt is now up
Jun  8 12:51:19 r1 sr_aaa_mgr: aaa|1528|1650|00000|N: Opened session for user admin from host 10.244.0.0
Jun  8 12:51:19 r1 sr_aaa_mgr: aaa|1528|1650|00001|N: User admin successfully authenticated from host 10.244.0.0
Jun  8 12:55:44 r1 sr_mgmt_server: mgmt|1693|1693|00020|I: All changes have been committed successfully by user admin session 1.
Jun  8 12:55:44 r1 sr_xdp_lc_1: debug|1739|1814|00001|E: common    netdevice.c:355             NetDeviceGetSpeed  ioctl(SIOCETHTOOL, "e1-1", 1 (0x1), 32684 (0x7fac)): Operation not supported (95)
Jun  8 12:55:44 r1 sr_xdp_lc_1: debug|1739|1814|00003|E: common    netdevice.c:182               NetDeviceSetMTU  ioctl(SIOCSIFMTU, "e1-1", 9232): Invalid argument (22)
Jun  8 12:55:44 r1 sr_xdp_lc_1: debug|1739|1814|00004|E: simif     sim_physif.cc:764            UpdateAdminState  error setting mtu for interface "ethernet-1/1" mtu: 9232
Jun  8 12:55:44 r1 sr_xdp_lc_1: debug|1739|1814|00005|E: common    netdevice.c:355             NetDeviceGetSpeed  ioctl(SIOCETHTOOL, "e1-1", 1 (0x1), 26571 (0x67cb)): Operation not supported (95)
Jun  8 12:55:44 r1 sr_net_inst_mgr: netinst|1704|1704|00014|N: Network Instance main is now up
Jun  8 12:55:45 r1 sr_net_inst_mgr: netinst|1704|1704|00015|W: The interface ethernet-1/1.0 in network-instance main is now down for reason: the subinterface is operationally down

[root@r1 ~]# tail /var/log/srlinux/debug/errors.log
2022-06-08T12:55:44.990045+00:00 r1 local6|ERR sr_xdp_lc_1: debug|1739|1814|00001|E: common    netdevice.c:355             NetDeviceGetSpeed  ioctl(SIOCETHTOOL, "e1-1", 1 (0x1), 32684 (0x7fac)): Operation not supported (95)
2022-06-08T12:55:44.990171+00:00 r1 local6|ERR sr_xdp_lc_1: debug|1739|1814|00003|E: common    netdevice.c:182               NetDeviceSetMTU  ioctl(SIOCSIFMTU, "e1-1", 9232): Invalid argument (22)
2022-06-08T12:55:44.990193+00:00 r1 local6|ERR sr_xdp_lc_1: debug|1739|1814|00004|E: simif     sim_physif.cc:764            UpdateAdminState  error setting mtu for interface "ethernet-1/1" mtu: 9232
2022-06-08T12:55:44.990805+00:00 r1 local6|ERR sr_xdp_lc_1: debug|1739|1814|00005|E: common    netdevice.c:355             NetDeviceGetSpeed  ioctl(SIOCETHTOOL, "e1-1", 1 (0x1), 26571 (0x67cb)): Operation not supported (95)

[root@r1 ~]# tail /var/log/srlinux/debug/sr_xdp_lc_1.log
2022-06-08T12:55:44.990045+00:00 r1 local6|ERR sr_xdp_lc_1: debug|1739|1814|00001|E: common    netdevice.c:355             NetDeviceGetSpeed  ioctl(SIOCETHTOOL, "e1-1", 1 (0x1), 32684 (0x7fac)): Operation not supported (95)
2022-06-08T12:55:44.990087+00:00 r1 local6|WARN sr_xdp_lc_1: debug|1739|1814|00002|W: simif     sim_physif.cc:218           GetInterfaceSpeed  Unable to get speed for interface: e1-1
2022-06-08T12:55:44.990171+00:00 r1 local6|ERR sr_xdp_lc_1: debug|1739|1814|00003|E: common    netdevice.c:182               NetDeviceSetMTU  ioctl(SIOCSIFMTU, "e1-1", 9232): Invalid argument (22)
2022-06-08T12:55:44.990193+00:00 r1 local6|ERR sr_xdp_lc_1: debug|1739|1814|00004|E: simif     sim_physif.cc:764            UpdateAdminState  error setting mtu for interface "ethernet-1/1" mtu: 9232
2022-06-08T12:55:44.990805+00:00 r1 local6|ERR sr_xdp_lc_1: debug|1739|1814|00005|E: common    netdevice.c:355             NetDeviceGetSpeed  ioctl(SIOCETHTOOL, "e1-1", 1 (0x1), 26571 (0x67cb)): Operation not supported (95)
2022-06-08T12:55:44.990828+00:00 r1 local6|WARN sr_xdp_lc_1: debug|1739|1814|00006|W: simif     sim_physif.cc:218           GetInterfaceSpeed  Unable to get speed for interface: e1-1
2022-06-08T12:55:45.006160+00:00 r1 local6|WARN sr_xdp_lc_1: debug|1739|2066|00009|W: cpmgr     cp_mgr.cc:1595       CpMgrExtractFrameHandler  interface 2147483647 not found for reason MLD
2022-06-08T12:55:45.018077+00:00 r1 local6|WARN sr_xdp_lc_1: debug|1739|2066|00010|W: cpmgr     cp_mgr.cc:1595       CpMgrExtractFrameHandler  interface 2147483647 not found for reason MLD
2022-06-08T12:55:45.658478+00:00 r1 local6|WARN sr_xdp_lc_1: debug|1739|2066|00011|W: cpmgr     cp_mgr.cc:1595       CpMgrExtractFrameHandler  interface 2147483647 not found for reason MLD
```
It seems we have an MTU issue for the 25G interfaces that by default get 9232. Maybe if we specify a lower MTU and set speed to 1G
```bash
--{ [FACTORY] + candidate shared default }--[  ]--
A:r1# info flat interface ethernet-1/1
set / interface ethernet-1/1
set / interface ethernet-1/1 admin-state enable
set / interface ethernet-1/1 mtu 1500
set / interface ethernet-1/1 ethernet
set / interface ethernet-1/1 ethernet port-speed 1G
set / interface ethernet-1/1 subinterface 0
set / interface ethernet-1/1 subinterface 0 ipv4
set / interface ethernet-1/1 subinterface 0 ipv4 address 10.1.1.1/30
--{ [FACTORY] + candidate shared default }--[  ]--

A:r1# show interface ethernet-1/1
==========================================================================
ethernet-1/1 is down, reason lower-layer-down
  ethernet-1/1.0 is down, reason ip-mtu-too-large
    Network-instance: main
    Encapsulation   : null
    Type            : routed
    IPv4 addr    : 10.1.1.1/30 (static, None)
--------------------------------------------------------------------------
==========================================================================
--{ [FACTORY] + candidate shared default }--[  ]--
A:r1
```
OK, let's check the MTU on the container then after deleting the configs in r1 to see the default situation
```bash
[root@r1 ~]# ip link
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
3: mgmt0@if7: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1514 qdisc noqueue state UP mode DEFAULT group default
    link/ether 86:28:21:01:2f:32 brd ff:ff:ff:ff:ff:ff link-netnsid 0
4: gway-2800@if2: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP mode DEFAULT group default qlen 1000
    link/ether 26:e1:9b:7f:82:07 brd ff:ff:ff:ff:ff:ff link-netns srbase-mgmt
5: mgmt0-0@if4: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP mode DEFAULT group default qlen 1000
    link/ether e2:33:67:b1:b0:8e brd ff:ff:ff:ff:ff:ff link-netns srbase-mgmt
    alias mgmt0.0
6: monit_in@if5: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 9234 qdisc noqueue state UP mode DEFAULT group default qlen 1000
    link/ether fa:13:fb:a3:7c:e6 brd ff:ff:ff:ff:ff:ff link-netns monit
8: e1-1@if8: <BROADCAST,MULTICAST> mtu 1450 qdisc noqueue state DOWN mode DEFAULT group default qlen 1000
    link/ether 02:ab:b7:ff:00:01 brd ff:ff:ff:ff:ff:ff link-netnsid 0
```
So, the interface is configured with an MTU of 1450, which I guess is inherited by our _host_ network adapter and also cannot be changed on the fly in the container. Let's see what we kave in k8s.
```bash
ubuntu@kates-control:~$ ip link
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
2: ens3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP mode DEFAULT group default qlen 1000
    link/ether 00:50:02:00:01:00 brd ff:ff:ff:ff:ff:ff
3: flannel.1: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1450 qdisc noqueue state UNKNOWN mode DEFAULT group default
    link/ether 5e:3c:ea:cf:bd:cd brd ff:ff:ff:ff:ff:ff
4: cni0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1450 qdisc noqueue state UP mode DEFAULT group default qlen 1000
    link/ether 92:19:8e:ea:71:f5 brd ff:ff:ff:ff:ff:ff
5: vethf00a4528@if3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1450 qdisc noqueue master cni0 state UP mode DEFAULT group default
    link/ether 92:85:21:c2:60:82 brd ff:ff:ff:ff:ff:ff link-netns cni-461b355e-9191-3b43-3778-e328f19016ef
6: vethd6c19f4d@if3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1450 qdisc noqueue master cni0 state UP mode DEFAULT group default
    link/ether d6:77:32:3c:c2:91 brd ff:ff:ff:ff:ff:ff link-netns cni-c88dd2d1-485d-2cd4-5f2d-d5b5539370eb
ubuntu@kates-control:~$
```
So flannel, since it is a VXLAN CNI inherits the MTU of ens3 _physical_ interface minus 50 overhead for the headers. I am thinking of an easy fix around this is to increase the MTU on the physical interface, i.e. EVE-NGs physical interface and k8s VMs one as well. Let's shutdown all VMs first and make the change to the EVE hosts.

```bash {hl_lines=[29-30]}
# Configure jumbo MTU on both EVE-NG nodes
root@eve-01:~# ip link set mtu 9000 dev eth0
root@eve-01:~# ip link set mtu 9000 dev pnet0

root@eve-02:~# ip link set mtu 9000 dev eth0
root@eve-02:~# ip link set mtu 9000 dev pnet0

# If you want to make it permanent
root@eve-01:~# head -n20 /etc/network/interfaces
# This file describes the network interfaces available on your system
# and how to activate them. For more information, see interfaces(5).

# The loopback network interface
auto lo
iface lo inet loopback

# The primary network interface
iface eth0 inet manual
auto pnet0
iface pnet0 inet static
    address 192.168.1.21
    netmask 255.255.255.0
    gateway 192.168.1.1
    dns-domain lab.net
    dns-nameservers 192.168.1.1 8.8.8.8
    bridge_ports eth0
    bridge_stp off
    mtu 9000
    post-up ifconfig eth0 mtu 9000

# Verify that jumbo MTU is supported on your infra
root@eve-01:~# ping 192.168.1.22 -Mdo -s 5000
PING 192.168.1.22 (192.168.1.22) 5000(5028) bytes of data.
5008 bytes from 192.168.1.22: icmp_seq=1 ttl=64 time=0.434 ms
5008 bytes from 192.168.1.22: icmp_seq=2 ttl=64 time=0.415 ms
5008 bytes from 192.168.1.22: icmp_seq=3 ttl=64 time=0.423 ms
5008 bytes from 192.168.1.22: icmp_seq=4 ttl=64 time=0.397 ms
^C
--- 192.168.1.22 ping statistics ---
4 packets transmitted, 4 received, 0% packet loss, time 3083ms
rtt min/avg/max/mdev = 0.397/0.417/0.434/0.019 ms

root@eve-02:~# tracepath -n 192.168.1.21
 1?: [LOCALHOST]                                         pmtu 9000
 1:  192.168.1.21                                          0.570ms reached
 1:  192.168.1.21                                          0.428ms reached
     Resume: pmtu 9000 hops 1 back 1
```
Bring up the k8s VMs and set the MTU there too.
```bash {hl_lines=[10]}
ubuntu@kates-control:~$ cat /etc/netplan/50-cloud-init.yaml
# This file is generated from information provided by the datasource.  Changes
# to it will not persist across an instance reboot.  To disable cloud-init's
# network configuration capabilities, write a file
# /etc/cloud/cloud.cfg.d/99-disable-network-config.cfg with the following:
# network: {config: disabled}
network:
    ethernets:
        ens3:
            mtu: 9000
            dhcp4: false
            dhcp6: false
            addresses: [192.168.1.30/24]
            gateway4: 192.168.1.1
            nameservers:
                    addresses: [192.168.1.1, 8.8.8.8]
    version: 2
```
Reboot all 3 VMs and check the network
```bash
ubuntu@kates-control:~$ ip link
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
2: ens3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 9000 qdisc fq_codel state UP mode DEFAULT group default qlen 1000
    link/ether 00:50:02:00:01:00 brd ff:ff:ff:ff:ff:ff
3: flannel.1: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 8950 qdisc noqueue state UNKNOWN mode DEFAULT group default
    link/ether 2a:d3:ae:2c:3a:47 brd ff:ff:ff:ff:ff:ff
4: cni0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 8950 qdisc noqueue state UP mode DEFAULT group default qlen 1000
    link/ether b2:26:5f:c2:46:4c brd ff:ff:ff:ff:ff:ff
5: veth48f89ceb@if3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 8950 qdisc noqueue master cni0 state UP mode DEFAULT group default
    link/ether 4a:f4:77:a3:32:db brd ff:ff:ff:ff:ff:ff link-netns cni-9818a9b4-e802-2a6c-fc91-c4e241c38383
6: vethafbac825@if3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 8950 qdisc noqueue master cni0 state UP mode DEFAULT group default
    link/ether c6:44:4c:53:b4:50 brd ff:ff:ff:ff:ff:ff link-netns cni-014e3a91-e088-0d4b-740b-1024368a45a4
```
It looks so much better now :smile:. OK, back on r1 then, let's see how it looks like on the networking side
```bash
ubuntu@kates-control:~$ kubectl -n 2srl-certs exec -it r1 -- bash
Defaulted container "r1" out of: r1, init-r1 (init)
[root@r1 /]# ip link
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
3: mgmt0@if10: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1514 qdisc noqueue state UP mode DEFAULT group default
    link/ether 2e:99:25:47:fe:3d brd ff:ff:ff:ff:ff:ff link-netnsid 0
4: gway-2800@if2: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP mode DEFAULT group default qlen 1000
    link/ether 66:fa:8c:11:28:47 brd ff:ff:ff:ff:ff:ff link-netns srbase-mgmt
5: mgmt0-0@if4: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP mode DEFAULT group default qlen 1000
    link/ether 0a:5d:84:d6:be:df brd ff:ff:ff:ff:ff:ff link-netns srbase-mgmt
    alias mgmt0.0
6: monit_in@if5: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 9234 qdisc noqueue state UP mode DEFAULT group default qlen 1000
    link/ether 76:35:de:b1:c1:a6 brd ff:ff:ff:ff:ff:ff link-netns monit
11: e1-1@if11: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 8950 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000
    link/ether be:d0:be:51:69:e3 brd ff:ff:ff:ff:ff:ff link-netnsid 0
[root@r1 /]#
```
Now lets configure the devices with the following commands
```bash
# on R1
--{ [FACTORY] + candidate shared default }--[  ]--
A:r1# info flat interface ethernet-1/1
set / interface ethernet-1/1
set / interface ethernet-1/1 mtu 1516
set / interface ethernet-1/1 ethernet
set / interface ethernet-1/1 ethernet port-speed 10G
set / interface ethernet-1/1 subinterface 0
set / interface ethernet-1/1 subinterface 0 ip-mtu 1500
set / interface ethernet-1/1 subinterface 0 ipv4
set / interface ethernet-1/1 subinterface 0 ipv4 address 10.1.1.1/30
--{ [FACTORY] + candidate shared default }--[  ]--
A:r1# info flat network-instance main
set / network-instance main
set / network-instance main interface ethernet-1/1.0

A:r1# show interface ethernet-1/1
==========================================================================
ethernet-1/1 is up, speed 10G, type None
  ethernet-1/1.0 is up
    Network-instance: main
    Encapsulation   : null
    Type            : routed
    IPv4 addr    : 10.1.1.1/30 (static, preferred, primary)
--------------------------------------------------------------------------
==========================================================================

# on R2
A:r2# info flat interface ethernet-1/1
set / interface ethernet-1/1
set / interface ethernet-1/1 mtu 1516
set / interface ethernet-1/1 ethernet
set / interface ethernet-1/1 ethernet port-speed 10G
set / interface ethernet-1/1 subinterface 0
set / interface ethernet-1/1 subinterface 0 ip-mtu 1500
set / interface ethernet-1/1 subinterface 0 ipv4
set / interface ethernet-1/1 subinterface 0 ipv4 address 10.1.1.2/30
--{ running }--[  ]--
A:r2# info flat network-instance main
set / network-instance main
set / network-instance main interface ethernet-1/1.0

# Check that we get pings

A:r2# ping 10.1.1.1 network-instance main
Using network instance main
PING 10.1.1.1 (10.1.1.1) 56(84) bytes of data.
64 bytes from 10.1.1.1: icmp_seq=1 ttl=64 time=58.8 ms
64 bytes from 10.1.1.1: icmp_seq=2 ttl=64 time=14.7 ms
64 bytes from 10.1.1.1: icmp_seq=3 ttl=64 time=9.13 ms
64 bytes from 10.1.1.1: icmp_seq=4 ttl=64 time=12.5 ms
64 bytes from 10.1.1.1: icmp_seq=5 ttl=64 time=14.7 ms
64 bytes from 10.1.1.1: icmp_seq=6 ttl=64 time=9.12 ms
64 bytes from 10.1.1.1: icmp_seq=7 ttl=64 time=12.5 ms
64 bytes from 10.1.1.1: icmp_seq=8 ttl=64 time=6.85 ms
^C
--- 10.1.1.1 ping statistics ---
8 packets transmitted, 8 received, 0% packet loss, time 7008ms
rtt min/avg/max/mdev = 6.853/17.291/58.831/15.918 ms
```
OK, now let's try out the other srlinux variants supported
```bash
ubuntu@kates-control:~$ kubectl -n 2srl-certs get cm
NAME                     DATA   AGE
kube-root-ca.crt         1      5h33m
srlinux-kne-entrypoint   1      5h33m
srlinux-topomac-script   1      5h33m
srlinux-variants         5      5h33m

ubuntu@kates-control:~$ kubectl -n 2srl-certs describe cm srlinux-variants | grep ^ixr
ixrd1:
ixrd10:
ixrd2:
ixrd3:
ixr6:
```
Create a simple lab containing only the node definitions.
```bash
ubuntu@kates-control:~/labs$ cat test-sr.pbtxt
name: "srl-test"
nodes: {
    name: "r1"
    vendor: NOKIA
    services:{
        key: 22
        value: {
            name: "ssh"
            inside: 22
        }
    }
    model: "ixr6"
}

nodes: {
    name: "r2"
    vendor: NOKIA
    services:{
        key: 22
        value: {
            name: "ssh"
            inside: 22
        }
    }
    model: "ixrd1"
}

nodes: {
    name: "r3"
    vendor: NOKIA
    services:{
        key: 22
        value: {
            name: "ssh"
            inside: 22
        }
    }
    model: "ixrd2"
}
nodes: {
    name: "r4"
    vendor: NOKIA
    services:{
        key: 22
        value: {
            name: "ssh"
            inside: 22
        }
    }
    model: "ixrd3"
}
nodes: {
    name: "r5"
    vendor: NOKIA
    services:{
        key: 22
        value: {
            name: "ssh"
            inside: 22
        }
    }
    model: "ixrd10"
}
```
And start it up.
```bash
ubuntu@kates-control:~/labs$ kne_cli create test-sr.pbtxt
INFO[0000] /home/ubuntu/labs
INFO[0000] Creating manager for: srl-test
INFO[0000] Trying in-cluster configuration
INFO[0000] Falling back to kubeconfig: "/home/ubuntu/.kube/config"
INFO[0000] Topology:
name: "srl-test"
nodes: <
  name: "r1"
  services: <
    key: 22
    value: <
      name: "ssh"
      inside: 22
    >
  >
  vendor: NOKIA
  model: "ixr6"
>
nodes: <
  name: "r2"
  services: <
    key: 22
    value: <
      name: "ssh"
      inside: 22
    >
  >
  vendor: NOKIA
  model: "ixrd1"
>
nodes: <
  name: "r3"
  services: <
    key: 22
    value: <
      name: "ssh"
      inside: 22
    >
  >
  vendor: NOKIA
  model: "ixrd2"
>
nodes: <
  name: "r4"
  services: <
    key: 22
    value: <
      name: "ssh"
      inside: 22
    >
  >
  vendor: NOKIA
  model: "ixrd3"
>
nodes: <
  name: "r5"
  services: <
    key: 22
    value: <
      name: "ssh"
      inside: 22
    >
  >
  vendor: NOKIA
  model: "ixrd10"
>

INFO[0000] Adding Node: r1:NOKIA:UNKNOWN
INFO[0000] Adding Node: r2:NOKIA:UNKNOWN
INFO[0000] Adding Node: r3:NOKIA:UNKNOWN
INFO[0000] Adding Node: r4:NOKIA:UNKNOWN
INFO[0000] Adding Node: r5:NOKIA:UNKNOWN
INFO[0000] Creating namespace for topology: "srl-test"
INFO[0000] Server Namespace: &Namespace{ObjectMeta:{srl-test    9209b1c5-6ea2-427f-8a2f-4f6e3705f8e8 53116 0 2022-06-08 18:41:57 +0000 UTC <nil> <nil> map[kubernetes.io/metadata.name:srl-test] map[] [] []  [{kne_cli Update v1 2022-06-08 18:41:57 +0000 UTC FieldsV1 {"f:metadata":{"f:labels":{".":{},"f:kubernetes.io/metadata.name":{}}}}}]},Spec:NamespaceSpec{Finalizers:[kubernetes],},Status:NamespaceStatus{Phase:Active,Conditions:[]NamespaceCondition{},},}
INFO[0000] Getting topology specs for namespace srl-test
INFO[0000] Getting topology specs for node r5
INFO[0000] Getting topology specs for node r1
INFO[0000] Getting topology specs for node r2
INFO[0000] Getting topology specs for node r3
INFO[0000] Getting topology specs for node r4
INFO[0000] Creating topology for meshnet node r2
INFO[0000] Meshnet Node:
&{TypeMeta:{Kind: APIVersion:} ObjectMeta:{Name:r2 GenerateName: Namespace:srl-test SelfLink: UID:c11bdba8-4d64-4aea-b065-858907ed8271 ResourceVersion:53119 Generation:1 CreationTimestamp:2022-06-08 18:41:57 +0000 UTC DeletionTimestamp:<nil> DeletionGracePeriodSeconds:<nil> Labels:map[] Annotations:map[] OwnerReferences:[] Finalizers:[] ClusterName: ManagedFields:[{Manager:kne_cli Operation:Update APIVersion:networkop.co.uk/v1beta1 Time:2022-06-08 18:41:57 +0000 UTC FieldsType:FieldsV1 FieldsV1:{"f:spec":{}}}]} Status:{TypeMeta:{Kind: APIVersion:} ObjectMeta:{Name: GenerateName: Namespace: SelfLink: UID: ResourceVersion: Generation:0 CreationTimestamp:0001-01-01 00:00:00 +0000 UTC DeletionTimestamp:<nil> DeletionGracePeriodSeconds:<nil> Labels:map[] Annotations:map[] OwnerReferences:[] Finalizers:[] ClusterName: ManagedFields:[]} Skipped:[] SrcIp: NetNs:} Spec:{TypeMeta:{Kind: APIVersion:} Links:[]}}
INFO[0000] Creating topology for meshnet node r3
INFO[0000] Meshnet Node:
&{TypeMeta:{Kind: APIVersion:} ObjectMeta:{Name:r3 GenerateName: Namespace:srl-test SelfLink: UID:3b0ca0fd-263a-400b-aec5-c2799a07f711 ResourceVersion:53120 Generation:1 CreationTimestamp:2022-06-08 18:41:57 +0000 UTC DeletionTimestamp:<nil> DeletionGracePeriodSeconds:<nil> Labels:map[] Annotations:map[] OwnerReferences:[] Finalizers:[] ClusterName: ManagedFields:[{Manager:kne_cli Operation:Update APIVersion:networkop.co.uk/v1beta1 Time:2022-06-08 18:41:57 +0000 UTC FieldsType:FieldsV1 FieldsV1:{"f:spec":{}}}]} Status:{TypeMeta:{Kind: APIVersion:} ObjectMeta:{Name: GenerateName: Namespace: SelfLink: UID: ResourceVersion: Generation:0 CreationTimestamp:0001-01-01 00:00:00 +0000 UTC DeletionTimestamp:<nil> DeletionGracePeriodSeconds:<nil> Labels:map[] Annotations:map[] OwnerReferences:[] Finalizers:[] ClusterName: ManagedFields:[]} Skipped:[] SrcIp: NetNs:} Spec:{TypeMeta:{Kind: APIVersion:} Links:[]}}
INFO[0000] Creating topology for meshnet node r4
INFO[0000] Meshnet Node:
&{TypeMeta:{Kind: APIVersion:} ObjectMeta:{Name:r4 GenerateName: Namespace:srl-test SelfLink: UID:66947ac6-f55a-4082-8eee-4afcbc513c33 ResourceVersion:53121 Generation:1 CreationTimestamp:2022-06-08 18:41:57 +0000 UTC DeletionTimestamp:<nil> DeletionGracePeriodSeconds:<nil> Labels:map[] Annotations:map[] OwnerReferences:[] Finalizers:[] ClusterName: ManagedFields:[{Manager:kne_cli Operation:Update APIVersion:networkop.co.uk/v1beta1 Time:2022-06-08 18:41:57 +0000 UTC FieldsType:FieldsV1 FieldsV1:{"f:spec":{}}}]} Status:{TypeMeta:{Kind: APIVersion:} ObjectMeta:{Name: GenerateName: Namespace: SelfLink: UID: ResourceVersion: Generation:0 CreationTimestamp:0001-01-01 00:00:00 +0000 UTC DeletionTimestamp:<nil> DeletionGracePeriodSeconds:<nil> Labels:map[] Annotations:map[] OwnerReferences:[] Finalizers:[] ClusterName: ManagedFields:[]} Skipped:[] SrcIp: NetNs:} Spec:{TypeMeta:{Kind: APIVersion:} Links:[]}}
INFO[0000] Creating topology for meshnet node r5
INFO[0000] Meshnet Node:
&{TypeMeta:{Kind: APIVersion:} ObjectMeta:{Name:r5 GenerateName: Namespace:srl-test SelfLink: UID:2f31adf0-3298-4709-a310-5144e1253913 ResourceVersion:53122 Generation:1 CreationTimestamp:2022-06-08 18:41:57 +0000 UTC DeletionTimestamp:<nil> DeletionGracePeriodSeconds:<nil> Labels:map[] Annotations:map[] OwnerReferences:[] Finalizers:[] ClusterName: ManagedFields:[{Manager:kne_cli Operation:Update APIVersion:networkop.co.uk/v1beta1 Time:2022-06-08 18:41:57 +0000 UTC FieldsType:FieldsV1 FieldsV1:{"f:spec":{}}}]} Status:{TypeMeta:{Kind: APIVersion:} ObjectMeta:{Name: GenerateName: Namespace: SelfLink: UID: ResourceVersion: Generation:0 CreationTimestamp:0001-01-01 00:00:00 +0000 UTC DeletionTimestamp:<nil> DeletionGracePeriodSeconds:<nil> Labels:map[] Annotations:map[] OwnerReferences:[] Finalizers:[] ClusterName: ManagedFields:[]} Skipped:[] SrcIp: NetNs:} Spec:{TypeMeta:{Kind: APIVersion:} Links:[]}}
INFO[0000] Creating topology for meshnet node r1
INFO[0000] Meshnet Node:
&{TypeMeta:{Kind: APIVersion:} ObjectMeta:{Name:r1 GenerateName: Namespace:srl-test SelfLink: UID:54123e29-d30e-4c6c-8e65-a2689d8bce5f ResourceVersion:53123 Generation:1 CreationTimestamp:2022-06-08 18:41:57 +0000 UTC DeletionTimestamp:<nil> DeletionGracePeriodSeconds:<nil> Labels:map[] Annotations:map[] OwnerReferences:[] Finalizers:[] ClusterName: ManagedFields:[{Manager:kne_cli Operation:Update APIVersion:networkop.co.uk/v1beta1 Time:2022-06-08 18:41:57 +0000 UTC FieldsType:FieldsV1 FieldsV1:{"f:spec":{}}}]} Status:{TypeMeta:{Kind: APIVersion:} ObjectMeta:{Name: GenerateName: Namespace: SelfLink: UID: ResourceVersion: Generation:0 CreationTimestamp:0001-01-01 00:00:00 +0000 UTC DeletionTimestamp:<nil> DeletionGracePeriodSeconds:<nil> Labels:map[] Annotations:map[] OwnerReferences:[] Finalizers:[] ClusterName: ManagedFields:[]} Skipped:[] SrcIp: NetNs:} Spec:{TypeMeta:{Kind: APIVersion:} Links:[]}}
INFO[0000] Creating Node Pods
INFO[0000] Creating Srlinux node resource r3
INFO[0000] Created SR Linux node r3 configmap
INFO[0000] Created Srlinux resource: r3
INFO[0000] Created Service:
&Service{ObjectMeta:{service-r3  srl-test  e1b53ca4-5334-42b1-bc76-d02541fae176 53133 0 2022-06-08 18:41:58 +0000 UTC <nil> <nil> map[pod:r3] map[] [] []  [{kne_cli Update v1 2022-06-08 18:41:58 +0000 UTC FieldsV1 {"f:metadata":{"f:labels":{".":{},"f:pod":{}}},"f:spec":{"f:allocateLoadBalancerNodePorts":{},"f:externalTrafficPolicy":{},"f:internalTrafficPolicy":{},"f:ports":{".":{},"k:{\"port\":22,\"protocol\":\"TCP\"}":{".":{},"f:name":{},"f:port":{},"f:protocol":{},"f:targetPort":{}}},"f:selector":{},"f:sessionAffinity":{},"f:type":{}}}}]},Spec:ServiceSpec{Ports:[]ServicePort{ServicePort{Name:ssh,Protocol:TCP,Port:22,TargetPort:{0 22 },NodePort:30482,AppProtocol:nil,},},Selector:map[string]string{app: r3,},ClusterIP:10.98.252.104,Type:LoadBalancer,ExternalIPs:[],SessionAffinity:None,LoadBalancerIP:,LoadBalancerSourceRanges:[],ExternalName:,ExternalTrafficPolicy:Cluster,HealthCheckNodePort:0,PublishNotReadyAddresses:false,SessionAffinityConfig:nil,TopologyKeys:[],IPFamilyPolicy:*SingleStack,ClusterIPs:[10.98.252.104],IPFamilies:[IPv4],AllocateLoadBalancerNodePorts:*true,LoadBalancerClass:nil,InternalTrafficPolicy:*Cluster,},Status:ServiceStatus{LoadBalancer:LoadBalancerStatus{Ingress:[]LoadBalancerIngress{},},Conditions:[]Condition{},},}
INFO[0000] Node "r3" resource created
INFO[0000] Creating Srlinux node resource r4
INFO[0000] Created SR Linux node r4 configmap
INFO[0000] Created Srlinux resource: r4
INFO[0000] Created Service:
&Service{ObjectMeta:{service-r4  srl-test  c83fd861-fdda-44af-984b-6fe94e3ab2b8 53151 0 2022-06-08 18:41:58 +0000 UTC <nil> <nil> map[pod:r4] map[] [] []  [{kne_cli Update v1 2022-06-08 18:41:58 +0000 UTC FieldsV1 {"f:metadata":{"f:labels":{".":{},"f:pod":{}}},"f:spec":{"f:allocateLoadBalancerNodePorts":{},"f:externalTrafficPolicy":{},"f:internalTrafficPolicy":{},"f:ports":{".":{},"k:{\"port\":22,\"protocol\":\"TCP\"}":{".":{},"f:name":{},"f:port":{},"f:protocol":{},"f:targetPort":{}}},"f:selector":{},"f:sessionAffinity":{},"f:type":{}}}}]},Spec:ServiceSpec{Ports:[]ServicePort{ServicePort{Name:ssh,Protocol:TCP,Port:22,TargetPort:{0 22 },NodePort:30936,AppProtocol:nil,},},Selector:map[string]string{app: r4,},ClusterIP:10.96.239.113,Type:LoadBalancer,ExternalIPs:[],SessionAffinity:None,LoadBalancerIP:,LoadBalancerSourceRanges:[],ExternalName:,ExternalTrafficPolicy:Cluster,HealthCheckNodePort:0,PublishNotReadyAddresses:false,SessionAffinityConfig:nil,TopologyKeys:[],IPFamilyPolicy:*SingleStack,ClusterIPs:[10.96.239.113],IPFamilies:[IPv4],AllocateLoadBalancerNodePorts:*true,LoadBalancerClass:nil,InternalTrafficPolicy:*Cluster,},Status:ServiceStatus{LoadBalancer:LoadBalancerStatus{Ingress:[]LoadBalancerIngress{},},Conditions:[]Condition{},},}
INFO[0000] Node "r4" resource created
INFO[0000] Creating Srlinux node resource r5
INFO[0000] Created SR Linux node r5 configmap
INFO[0000] Created Srlinux resource: r5
INFO[0001] Created Service:
&Service{ObjectMeta:{service-r5  srl-test  0b6ab531-b20d-45a4-ac83-d1ce10f08547 53165 0 2022-06-08 18:41:58 +0000 UTC <nil> <nil> map[pod:r5] map[] [] []  [{kne_cli Update v1 2022-06-08 18:41:58 +0000 UTC FieldsV1 {"f:metadata":{"f:labels":{".":{},"f:pod":{}}},"f:spec":{"f:allocateLoadBalancerNodePorts":{},"f:externalTrafficPolicy":{},"f:internalTrafficPolicy":{},"f:ports":{".":{},"k:{\"port\":22,\"protocol\":\"TCP\"}":{".":{},"f:name":{},"f:port":{},"f:protocol":{},"f:targetPort":{}}},"f:selector":{},"f:sessionAffinity":{},"f:type":{}}}}]},Spec:ServiceSpec{Ports:[]ServicePort{ServicePort{Name:ssh,Protocol:TCP,Port:22,TargetPort:{0 22 },NodePort:31089,AppProtocol:nil,},},Selector:map[string]string{app: r5,},ClusterIP:10.109.164.166,Type:LoadBalancer,ExternalIPs:[],SessionAffinity:None,LoadBalancerIP:,LoadBalancerSourceRanges:[],ExternalName:,ExternalTrafficPolicy:Cluster,HealthCheckNodePort:0,PublishNotReadyAddresses:false,SessionAffinityConfig:nil,TopologyKeys:[],IPFamilyPolicy:*SingleStack,ClusterIPs:[10.109.164.166],IPFamilies:[IPv4],AllocateLoadBalancerNodePorts:*true,LoadBalancerClass:nil,InternalTrafficPolicy:*Cluster,},Status:ServiceStatus{LoadBalancer:LoadBalancerStatus{Ingress:[]LoadBalancerIngress{},},Conditions:[]Condition{},},}
INFO[0001] Node "r5" resource created
INFO[0001] Creating Srlinux node resource r1
INFO[0001] Created SR Linux node r1 configmap
INFO[0001] Created Srlinux resource: r1
INFO[0001] Created Service:
&Service{ObjectMeta:{service-r1  srl-test  2c60749c-43d4-498b-90c8-0bf4e319e8fc 53180 0 2022-06-08 18:41:59 +0000 UTC <nil> <nil> map[pod:r1] map[] [] []  [{kne_cli Update v1 2022-06-08 18:41:59 +0000 UTC FieldsV1 {"f:metadata":{"f:labels":{".":{},"f:pod":{}}},"f:spec":{"f:allocateLoadBalancerNodePorts":{},"f:externalTrafficPolicy":{},"f:internalTrafficPolicy":{},"f:ports":{".":{},"k:{\"port\":22,\"protocol\":\"TCP\"}":{".":{},"f:name":{},"f:port":{},"f:protocol":{},"f:targetPort":{}}},"f:selector":{},"f:sessionAffinity":{},"f:type":{}}}}]},Spec:ServiceSpec{Ports:[]ServicePort{ServicePort{Name:ssh,Protocol:TCP,Port:22,TargetPort:{0 22 },NodePort:30431,AppProtocol:nil,},},Selector:map[string]string{app: r1,},ClusterIP:10.99.13.223,Type:LoadBalancer,ExternalIPs:[],SessionAffinity:None,LoadBalancerIP:,LoadBalancerSourceRanges:[],ExternalName:,ExternalTrafficPolicy:Cluster,HealthCheckNodePort:0,PublishNotReadyAddresses:false,SessionAffinityConfig:nil,TopologyKeys:[],IPFamilyPolicy:*SingleStack,ClusterIPs:[10.99.13.223],IPFamilies:[IPv4],AllocateLoadBalancerNodePorts:*true,LoadBalancerClass:nil,InternalTrafficPolicy:*Cluster,},Status:ServiceStatus{LoadBalancer:LoadBalancerStatus{Ingress:[]LoadBalancerIngress{},},Conditions:[]Condition{},},}
INFO[0001] Node "r1" resource created
INFO[0001] Creating Srlinux node resource r2
INFO[0001] Created SR Linux node r2 configmap
INFO[0001] Created Srlinux resource: r2
INFO[0001] Created Service:
&Service{ObjectMeta:{service-r2  srl-test  0ee27dd3-5e80-429a-afb1-f13f9b99555c 53198 0 2022-06-08 18:41:59 +0000 UTC <nil> <nil> map[pod:r2] map[] [] []  [{kne_cli Update v1 2022-06-08 18:41:59 +0000 UTC FieldsV1 {"f:metadata":{"f:labels":{".":{},"f:pod":{}}},"f:spec":{"f:allocateLoadBalancerNodePorts":{},"f:externalTrafficPolicy":{},"f:internalTrafficPolicy":{},"f:ports":{".":{},"k:{\"port\":22,\"protocol\":\"TCP\"}":{".":{},"f:name":{},"f:port":{},"f:protocol":{},"f:targetPort":{}}},"f:selector":{},"f:sessionAffinity":{},"f:type":{}}}}]},Spec:ServiceSpec{Ports:[]ServicePort{ServicePort{Name:ssh,Protocol:TCP,Port:22,TargetPort:{0 22 },NodePort:30699,AppProtocol:nil,},},Selector:map[string]string{app: r2,},ClusterIP:10.106.39.51,Type:LoadBalancer,ExternalIPs:[],SessionAffinity:None,LoadBalancerIP:,LoadBalancerSourceRanges:[],ExternalName:,ExternalTrafficPolicy:Cluster,HealthCheckNodePort:0,PublishNotReadyAddresses:false,SessionAffinityConfig:nil,TopologyKeys:[],IPFamilyPolicy:*SingleStack,ClusterIPs:[10.106.39.51],IPFamilies:[IPv4],AllocateLoadBalancerNodePorts:*true,LoadBalancerClass:nil,InternalTrafficPolicy:*Cluster,},Status:ServiceStatus{LoadBalancer:LoadBalancerStatus{Ingress:[]LoadBalancerIngress{},},Conditions:[]Condition{},},}
INFO[0001] Node "r2" resource created
INFO[0003] Node "r2": Status RUNNING
INFO[0003] Node "r1": Status RUNNING
INFO[0003] Node "r3": Status RUNNING
INFO[0004] Node "r4": Status RUNNING
INFO[0004] Node "r5": Status RUNNING
INFO[0004] Topology "srl-test" created
INFO[0006] Pods:
INFO[0006] r5
INFO[0006] r1
INFO[0006] r2
INFO[0006] r3
INFO[0006] r4
```
Let's see what we have on k8s.
```bash
ubuntu@kates-control:~$ kubectl -n srl-test get all -owide
NAME     READY   STATUS             RESTARTS      AGE   IP            NODE            NOMINATED NODE   READINESS GATES
pod/r1   0/1     CrashLoopBackOff   2 (28s ago)   70s   10.244.1.20   kates-node-01   <none>           <none>
pod/r2   1/1     Running            0             70s   10.244.2.22   kates-node-02   <none>           <none>
pod/r3   1/1     Running            0             71s   10.244.2.20   kates-node-02   <none>           <none>
pod/r4   1/1     Running            0             71s   10.244.1.19   kates-node-01   <none>           <none>
pod/r5   0/1     CrashLoopBackOff   2 (22s ago)   71s   10.244.2.21   kates-node-02   <none>           <none>

NAME                 TYPE           CLUSTER-IP       EXTERNAL-IP    PORT(S)        AGE   SELECTOR
service/service-r1   LoadBalancer   10.99.13.223     192.168.1.53   22:30431/TCP   70s   app=r1
service/service-r2   LoadBalancer   10.106.39.51     192.168.1.54   22:30699/TCP   70s   app=r2
service/service-r3   LoadBalancer   10.98.252.104    192.168.1.50   22:30482/TCP   71s   app=r3
service/service-r4   LoadBalancer   10.96.239.113    192.168.1.51   22:30936/TCP   71s   app=r4
service/service-r5   LoadBalancer   10.109.164.166   192.168.1.52   22:31089/TCP   71s   app=r5
ubuntu@kates-control:~$
```
So, r1 and r5 are loop crashing and from the logs it seems something hardware related.
```bash {hl_lines=[14]}
ubuntu@kates-control:~$ kubectl -n srl-test logs r1
Defaulted container "r1" out of: r1, init-r1 (init)
Wed Jun  8 18:59:10 UTC 2022: entrypoint.sh called
Wed Jun  8 18:59:10 UTC 2022: renaming docker interface eth0 to mgmt0
Cannot find device "eth0"
Device "eth0" does not exist.
Cannot find device "eth0"
Cannot find device "eth0"
Wed Jun  8 18:59:10 UTC 2022: turning off checksum offloading on mgmt0
Wed Jun  8 18:59:10 UTC 2022: starting sshd
ssh-keygen: generating new host keys: RSA DSA ECDSA ED25519
Wed Jun  8 18:59:11 UTC 2022: Calling boot_run script
cat: /sys/class/dmi/id/board_name: No such file or directory
/opt/srlinux/bin/bootscript/01_sr_bdb_arbitration.sh: line 9:    97 Aborted                 (core dumped) ${dev_mgr} --hw-details --matelink --log-stdout > ${arbitration_log}
cat: /sys/class/dmi/id/board_name: No such file or directory
/opt/srlinux/bin/bootscript/05_sr_createuser.sh: line 270: !srl_is_running_on_nokia_rootfs: command not found
/opt/srlinux/bin/bootscript/05_sr_createuser.sh: line 282: python: command not found
chmod: cannot access '/dev/console': No such file or directory
chmod: missing operand after '0664'
Try 'chmod --help' for more information.
/usr/bin/find: '/var/log/srlinux/file': No such file or directory
logmgr_set_env.sh: plain_bootup_start
Wed Jun  8 18:59:13 UTC 2022  logmgr_set_env.sh: restart of rsyslogd
which: no python in (/opt/srlinux/bin:/opt/srlinux/usr/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin)
readlink: missing operand
Try 'readlink --help' for more information.
setfacl: /mnt/nokiaos: No such file or directory
setfacl: /mnt/nokiaos: No such file or directory
setfacl: /mnt/nokiaos: No such file or directory
setfacl: /mnt/nokiaos: No such file or directory
setfacl: Option -m: Invalid argument near character 5
setfacl: Option -m: Invalid argument near character 3
setfacl: Option -m: Invalid argument near character 5
setfacl: Option -m: Invalid argument near character 3
System has not been booted with systemd as init system (PID 1). Can't operate.
Failed to connect to bus: Host is down
Failed to open connection to "system" message bus: Failed to connect to socket /run/dbus/system_bus_socket: No such file or directory
System has not been booted with systemd as init system (PID 1). Can't operate.
Failed to connect to bus: Host is down
findfs: unable to resolve 'LABEL=EFI-System'
No disk with label EFI-System is found
Failed to set capabilities on file `/usr/sbin/tcpdump' (No such file or directory)
usage: setcap [-q] [-v] [-n <rootid>] (-r|-|<caps>) <filename> [ ... (-r|-|<capsN>) <filenameN> ]

 Note <filename> must be a regular (non-symlink) file.
Wed Jun  8 18:59:15 UTC 2022: entrypoint.sh done, executing sudo bash -c touch /.dockerenv && /opt/srlinux/bin/sr_linux
No/Invalid license found!
Not starting in a named namespace, giving it the name "srbase"
Unix domain socket directory is /opt/srlinux/var/run/
Log directory is /var/log/srlinux/stdout
  Started supportd: source /etc/profile.d/sr_app_env.sh &>/dev/null; bash -c "./sr_supportd --server-mode" >/var/log/srlinux/stdout/supportd.log 2>&1 &
  Application supportd is running: PID 1474
  Started dev_mgr: source /etc/profile.d/sr_app_env.sh &>/dev/null; bash -c "./sr_device_mgr" >/var/log/srlinux/stdout/dev_mgr.log 2>&1 &
  Application dev_mgr is running: PID 1496
  Found dev_mgr: PID 1496 - killing
  Found supportd: PID 1474 - killing
  Failed to kill supportd: PID 1474. Another kill is retried
```
I guess more to troubleshoot, but for another time :smile:. Let's see what we got for the other variants

| Device | Variant | Chassis Type | Specs |
|:---:|:---:|:---:|:---:|
| r1 | ixr6 | NA  | NA |
| r2 | ixrd1 | 7220 IXR-D1 | 48x1G , 4x10G |
| r3 | ixrd2 | 7220 IXR-D2 | 48x25G, 4x100G |
| r4 | ixrd3 | 7220 IXR-D3 | 2x10G, 32x100G |
| r5 | ixrd10 | NA | NA |

___
### Test Arista cEOS
___
Get the arista container image and copy it to all k8s nodes or only to the workers if you control-plane is tainted. Then import it in each node.
```bash
ubuntu@kates-control:~$ sudo ctr -n k8s.io image import ceos.tgz
unpacking docker.io/library/ceos:latest (sha256:bfd3f2fea1cad2d06f0e5113cb3a1dc81f0ccbb28acf11949e15dadcf68eda9a)...done
```
Let's create a simple lab file.
```bash
ubuntu@kates-control:~/labs$ cat ceos.pbtxt
name: "arista"
nodes: {
    name: "r1"
    type: ARISTA_CEOS
    services:{
        key: 22
        value: {
            name: "ssh"
            inside: 22
        }
    }
}
nodes: {
    name: "r2"
    type: ARISTA_CEOS
    services:{
        key: 22
        value: {
            name: "ssh"
            inside: 22
        }
    }
}
links: {
    a_node: "r1"
    a_int: "eth1"
    z_node: "r2"
    z_int: "eth1"
}

links: {
    a_node: "r1"
    a_int: "eth2"
    z_node: "r2"
    z_int: "eth2"
}
```
And fire up the topology.
```bash
ubuntu@kates-control:~/labs$ kne_cli create ceos.pbtxt
INFO[0000] /home/ubuntu/labs
INFO[0000] Creating manager for: arista
INFO[0000] Trying in-cluster configuration
INFO[0000] Falling back to kubeconfig: "/home/ubuntu/.kube/config"
INFO[0000] Topology:
name: "arista"
nodes: <
  name: "r1"
  type: ARISTA_CEOS
  services: <
    key: 22
    value: <
      name: "ssh"
      inside: 22
    >
  >
>
nodes: <
  name: "r2"
  type: ARISTA_CEOS
  services: <
    key: 22
    value: <
      name: "ssh"
      inside: 22
    >
  >
>
links: <
  a_node: "r1"
  a_int: "eth1"
  z_node: "r2"
  z_int: "eth1"
>
links: <
  a_node: "r1"
  a_int: "eth2"
  z_node: "r2"
  z_int: "eth2"
>

INFO[0000] Adding Link: r1:eth1 r2:eth1
INFO[0000] Adding Link: r1:eth2 r2:eth2
INFO[0000] Adding Node: r1:UNKNOWN:ARISTA_CEOS
INFO[0000] Adding Node: r2:UNKNOWN:ARISTA_CEOS
INFO[0000] Creating namespace for topology: "arista"
INFO[0000] Server Namespace: &Namespace{ObjectMeta:{arista    82fe4826-a7dd-4fa3-bf2d-36d09236c2d7 71849 0 2022-06-08 20:49:14 +0000 UTC <nil> <nil> map[kubernetes.io/metadata.name:arista] map[] [] []  [{kne_cli Update v1 2022-06-08 20:49:14 +0000 UTC FieldsV1 {"f:metadata":{"f:labels":{".":{},"f:kubernetes.io/metadata.name":{}}}}}]},Spec:NamespaceSpec{Finalizers:[kubernetes],},Status:NamespaceStatus{Phase:Active,Conditions:[]NamespaceCondition{},},}
INFO[0000] Getting topology specs for namespace arista
INFO[0000] Getting topology specs for node r1
INFO[0000] Getting topology specs for node r2
INFO[0000] Creating topology for meshnet node r1
INFO[0000] Meshnet Node:
&{TypeMeta:{Kind: APIVersion:} ObjectMeta:{Name:r1 GenerateName: Namespace:arista SelfLink: UID:ba43116d-1c55-4e43-9201-cd7f2c9f3259 ResourceVersion:71852 Generation:1 CreationTimestamp:2022-06-08 20:49:14 +0000 UTC DeletionTimestamp:<nil> DeletionGracePeriodSeconds:<nil> Labels:map[] Annotations:map[] OwnerReferences:[] Finalizers:[] ClusterName: ManagedFields:[{Manager:kne_cli Operation:Update APIVersion:networkop.co.uk/v1beta1 Time:2022-06-08 20:49:14 +0000 UTC FieldsType:FieldsV1 FieldsV1:{"f:spec":{".":{},"f:links":{}}}}]} Status:{TypeMeta:{Kind: APIVersion:} ObjectMeta:{Name: GenerateName: Namespace: SelfLink: UID: ResourceVersion: Generation:0 CreationTimestamp:0001-01-01 00:00:00 +0000 UTC DeletionTimestamp:<nil> DeletionGracePeriodSeconds:<nil> Labels:map[] Annotations:map[] OwnerReferences:[] Finalizers:[] ClusterName: ManagedFields:[]} Skipped:[] SrcIp: NetNs:} Spec:{TypeMeta:{Kind: APIVersion:} Links:[{LocalIntf:eth1 LocalIP: PeerIntf:eth1 PeerIP: PeerPod:r2 UID:0} {LocalIntf:eth2 LocalIP: PeerIntf:eth2 PeerIP: PeerPod:r2 UID:1}]}}
INFO[0000] Creating topology for meshnet node r2
INFO[0000] Meshnet Node:
&{TypeMeta:{Kind: APIVersion:} ObjectMeta:{Name:r2 GenerateName: Namespace:arista SelfLink: UID:e677078e-0dc1-4e02-8258-b759acb61cfd ResourceVersion:71853 Generation:1 CreationTimestamp:2022-06-08 20:49:14 +0000 UTC DeletionTimestamp:<nil> DeletionGracePeriodSeconds:<nil> Labels:map[] Annotations:map[] OwnerReferences:[] Finalizers:[] ClusterName: ManagedFields:[{Manager:kne_cli Operation:Update APIVersion:networkop.co.uk/v1beta1 Time:2022-06-08 20:49:14 +0000 UTC FieldsType:FieldsV1 FieldsV1:{"f:spec":{".":{},"f:links":{}}}}]} Status:{TypeMeta:{Kind: APIVersion:} ObjectMeta:{Name: GenerateName: Namespace: SelfLink: UID: ResourceVersion: Generation:0 CreationTimestamp:0001-01-01 00:00:00 +0000 UTC DeletionTimestamp:<nil> DeletionGracePeriodSeconds:<nil> Labels:map[] Annotations:map[] OwnerReferences:[] Finalizers:[] ClusterName: ManagedFields:[]} Skipped:[] SrcIp: NetNs:} Spec:{TypeMeta:{Kind: APIVersion:} Links:[{LocalIntf:eth1 LocalIP: PeerIntf:eth1 PeerIP: PeerPod:r1 UID:0} {LocalIntf:eth2 LocalIP: PeerIntf:eth2 PeerIP: PeerPod:r1 UID:1}]}}
INFO[0000] Creating Node Pods
INFO[0000] Creating Pod:
 name:"r1" type:ARISTA_CEOS labels:{key:"model" value:""} labels:{key:"os" value:""} labels:{key:"type" value:"ARISTA_CEOS"} labels:{key:"vendor" value:"ARISTA"} labels:{key:"version" value:""} config:{command:"/sbin/init" command:"systemd.setenv=INTFTYPE=eth" command:"systemd.setenv=ETBA=1" command:"systemd.setenv=SKIP_ZEROTOUCH_BARRIER_IN_SYSDBINIT=1" command:"systemd.setenv=CEOS=1" command:"systemd.setenv=EOS_PLATFORM=ceoslab" command:"systemd.setenv=container=docker" image:"ceos:latest" env:{key:"CEOS" value:"1"} env:{key:"EOS_PLATFORM" value:"ceoslab"} env:{key:"ETBA" value:"1"} env:{key:"INTFTYPE" value:"eth"} env:{key:"SKIP_ZEROTOUCH_BARRIER_IN_SYSDBINIT" value:"1"} env:{key:"container" value:"docker"} entry_command:"kubectl exec -it r1 -- Cli" config_path:"/mnt/flash" config_file:"startup-config"} services:{key:22 value:{name:"ssh" inside:22}} constraints:{key:"cpu" value:"0.5"} constraints:{key:"memory" value:"1Gi"} interfaces:{key:"eth1" value:{name:"Ethernet1" int_name:"eth1" peer_name:"r2" peer_int_name:"eth1"}} interfaces:{key:"eth2" value:{name:"Ethernet2" int_name:"eth2" peer_name:"r2" peer_int_name:"eth2" uid:1}}
INFO[0000] Created Service:
&Service{ObjectMeta:{service-r1  arista  4c93f283-7153-4813-aca5-875e70277c9a 71860 0 2022-06-08 20:49:14 +0000 UTC <nil> <nil> map[pod:r1] map[] [] []  [{kne_cli Update v1 2022-06-08 20:49:14 +0000 UTC FieldsV1 {"f:metadata":{"f:labels":{".":{},"f:pod":{}}},"f:spec":{"f:allocateLoadBalancerNodePorts":{},"f:externalTrafficPolicy":{},"f:internalTrafficPolicy":{},"f:ports":{".":{},"k:{\"port\":22,\"protocol\":\"TCP\"}":{".":{},"f:name":{},"f:port":{},"f:protocol":{},"f:targetPort":{}}},"f:selector":{},"f:sessionAffinity":{},"f:type":{}}}}]},Spec:ServiceSpec{Ports:[]ServicePort{ServicePort{Name:ssh,Protocol:TCP,Port:22,TargetPort:{0 22 },NodePort:31088,AppProtocol:nil,},},Selector:map[string]string{app: r1,},ClusterIP:10.102.188.238,Type:LoadBalancer,ExternalIPs:[],SessionAffinity:None,LoadBalancerIP:,LoadBalancerSourceRanges:[],ExternalName:,ExternalTrafficPolicy:Cluster,HealthCheckNodePort:0,PublishNotReadyAddresses:false,SessionAffinityConfig:nil,TopologyKeys:[],IPFamilyPolicy:*SingleStack,ClusterIPs:[10.102.188.238],IPFamilies:[IPv4],AllocateLoadBalancerNodePorts:*true,LoadBalancerClass:nil,InternalTrafficPolicy:*Cluster,},Status:ServiceStatus{LoadBalancer:LoadBalancerStatus{Ingress:[]LoadBalancerIngress{},},Conditions:[]Condition{},},}
INFO[0000] Node "r1" resource created
INFO[0000] Creating Pod:
 name:"r2" type:ARISTA_CEOS labels:{key:"model" value:""} labels:{key:"os" value:""} labels:{key:"type" value:"ARISTA_CEOS"} labels:{key:"vendor" value:"ARISTA"} labels:{key:"version" value:""} config:{command:"/sbin/init" command:"systemd.setenv=INTFTYPE=eth" command:"systemd.setenv=ETBA=1" command:"systemd.setenv=SKIP_ZEROTOUCH_BARRIER_IN_SYSDBINIT=1" command:"systemd.setenv=CEOS=1" command:"systemd.setenv=EOS_PLATFORM=ceoslab" command:"systemd.setenv=container=docker" image:"ceos:latest" env:{key:"CEOS" value:"1"} env:{key:"EOS_PLATFORM" value:"ceoslab"} env:{key:"ETBA" value:"1"} env:{key:"INTFTYPE" value:"eth"} env:{key:"SKIP_ZEROTOUCH_BARRIER_IN_SYSDBINIT" value:"1"} env:{key:"container" value:"docker"} entry_command:"kubectl exec -it r2 -- Cli" config_path:"/mnt/flash" config_file:"startup-config"} services:{key:22 value:{name:"ssh" inside:22}} constraints:{key:"cpu" value:"0.5"} constraints:{key:"memory" value:"1Gi"} interfaces:{key:"eth1" value:{name:"Ethernet1" int_name:"eth1" peer_name:"r1" peer_int_name:"eth1"}} interfaces:{key:"eth2" value:{name:"Ethernet2" int_name:"eth2" peer_name:"r1" peer_int_name:"eth2" uid:1}}
INFO[0000] Created Service:
&Service{ObjectMeta:{service-r2  arista  1ff432b7-ddd9-4ee4-9a07-dc28be6053d8 71872 0 2022-06-08 20:49:14 +0000 UTC <nil> <nil> map[pod:r2] map[] [] []  [{kne_cli Update v1 2022-06-08 20:49:14 +0000 UTC FieldsV1 {"f:metadata":{"f:labels":{".":{},"f:pod":{}}},"f:spec":{"f:allocateLoadBalancerNodePorts":{},"f:externalTrafficPolicy":{},"f:internalTrafficPolicy":{},"f:ports":{".":{},"k:{\"port\":22,\"protocol\":\"TCP\"}":{".":{},"f:name":{},"f:port":{},"f:protocol":{},"f:targetPort":{}}},"f:selector":{},"f:sessionAffinity":{},"f:type":{}}}}]},Spec:ServiceSpec{Ports:[]ServicePort{ServicePort{Name:ssh,Protocol:TCP,Port:22,TargetPort:{0 22 },NodePort:30761,AppProtocol:nil,},},Selector:map[string]string{app: r2,},ClusterIP:10.110.58.235,Type:LoadBalancer,ExternalIPs:[],SessionAffinity:None,LoadBalancerIP:,LoadBalancerSourceRanges:[],ExternalName:,ExternalTrafficPolicy:Cluster,HealthCheckNodePort:0,PublishNotReadyAddresses:false,SessionAffinityConfig:nil,TopologyKeys:[],IPFamilyPolicy:*SingleStack,ClusterIPs:[10.110.58.235],IPFamilies:[IPv4],AllocateLoadBalancerNodePorts:*true,LoadBalancerClass:nil,InternalTrafficPolicy:*Cluster,},Status:ServiceStatus{LoadBalancer:LoadBalancerStatus{Ingress:[]LoadBalancerIngress{},},Conditions:[]Condition{},},}
INFO[0000] Node "r2" resource created
INFO[0004] Node "r2": Status RUNNING
INFO[0004] Node "r1": Status RUNNING
INFO[0004] Topology "arista" created
INFO[0005] Pods:
INFO[0005] r1
INFO[0005] r2
```
Check on k8s.
```bash
ubuntu@kates-control:~$ kubectl -n arista get all -o wide
NAME     READY   STATUS    RESTARTS   AGE   IP            NODE            NOMINATED NODE   READINESS GATES
pod/r1   1/1     Running   0          62s   10.244.1.23   kates-node-01   <none>           <none>
pod/r2   1/1     Running   0          62s   10.244.2.25   kates-node-02   <none>           <none>

NAME                 TYPE           CLUSTER-IP       EXTERNAL-IP    PORT(S)        AGE   SELECTOR
service/service-r1   LoadBalancer   10.102.188.238   192.168.1.50   22:31088/TCP   62s   app=r1
service/service-r2   LoadBalancer   10.110.58.235    192.168.1.51   22:30761/TCP   62s   app=r2
```
Seems good. Let's perform the initial configuration.
```bash
# For r1
ubuntu@kates-control:~$ kubectl -n arista exec -it r1 -- Cli
Defaulted container "r1" out of: r1, init-r1 (init)
localhost>en
localhost#conf
localhost(config)#hostname r1
r1(config)#interface ethernet 1
r1(config-if-Et1)#no switchport
r1(config-if-Et1)#ip address 10.1.1.1/30
r1(config-if-Et1)#interface ethernet 2
r1(config-if-Et2)#no switchport
r1(config-if-Et2)#ip address 10.2.2.1/30
r1(config-if-Et2)#end
r1#conf
r1(config)#username admin privilege 15 secret admin
r1(config)#end
r1#write
Copy completed successfully.
r1#show interfaces status
Port       Name   Status       Vlan     Duplex Speed  Type            Flags Encapsulation
Et1               connected    routed   full   1G     EbraTestPhyPort
Et2               connected    routed   full   1G     EbraTestPhyPort

# For r2
ubuntu@kates-control:~$ kubectl -n arista exec -it r2 -- Cli
Defaulted container "r2" out of: r2, init-r2 (init)
localhost>en
localhost#conf
localhost(config)#hostname r2
r2(config)#username admin privilege 15 secret admin
r2(config)#interface ethernet 1
r2(config-if-Et1)#no switchport
r2(config-if-Et1)#ip address 10.1.1.2/30
r2(config-if-Et1)#interface ethernet 2
r2(config-if-Et2)#no switchport
r2(config-if-Et2)#ip address 10.2.2.2/30
r2(config-if-Et2)#end
r2#write
Copy completed successfully.

# Check connectivity

r2#ping 10.1.1.1
PING 10.1.1.1 (10.1.1.1) 72(100) bytes of data.
80 bytes from 10.1.1.1: icmp_seq=1 ttl=64 time=1.36 ms
80 bytes from 10.1.1.1: icmp_seq=2 ttl=64 time=0.482 ms
80 bytes from 10.1.1.1: icmp_seq=3 ttl=64 time=0.621 ms
80 bytes from 10.1.1.1: icmp_seq=4 ttl=64 time=0.452 ms
80 bytes from 10.1.1.1: icmp_seq=5 ttl=64 time=1.26 ms

--- 10.1.1.1 ping statistics ---
5 packets transmitted, 5 received, 0% packet loss, time 4ms
rtt min/avg/max/mdev = 0.452/0.836/1.362/0.397 ms, ipg/ewma 1.118/1.106 ms
r2#ping 10.2.2.1
PING 10.2.2.1 (10.2.2.1) 72(100) bytes of data.
80 bytes from 10.2.2.1: icmp_seq=1 ttl=64 time=1.14 ms
80 bytes from 10.2.2.1: icmp_seq=2 ttl=64 time=0.512 ms
80 bytes from 10.2.2.1: icmp_seq=3 ttl=64 time=0.555 ms
80 bytes from 10.2.2.1: icmp_seq=4 ttl=64 time=0.556 ms
80 bytes from 10.2.2.1: icmp_seq=5 ttl=64 time=0.490 ms

--- 10.2.2.1 ping statistics ---
5 packets transmitted, 5 received, 0% packet loss, time 4ms
rtt min/avg/max/mdev = 0.490/0.650/1.140/0.247 ms, ipg/ewma 1.064/0.886 ms

# Test OOB SSH access
ubuntu@kates-control:~$ ssh admin@192.168.1.50
Password:
r1>en
r1#conf
r1(config)#interface ethernet 1 - 2
r1(config-if-Et1-2)#shutdown
r1(config-if-Et1-2)#end
r1#show user de
Session       Username       Roles               TTY        State       Duration       Auth        Remote Host
------------- -------------- ------------------- ---------- ----------- -------------- ----------- -----------
13            admin          network-admin       vty5       E           0:00:24        local       10.244.0.0
r1#show interfaces status
Port       Name   Status       Vlan     Duplex Speed  Type            Flags Encapsulation
Et1               disabled     routed   full   1G     EbraTestPhyPort
Et2               disabled     routed   full   1G     EbraTestPhyPort
```
Seems we are ready now for some serious labbing. :smile:
___
### References and influences
 - [KNE on github](https://github.com/google/kne)
 - [Inspired by this Blog post](https://blog.itsalwaysthe.network/posts/kubernetes-based-network-emulation/)
 - [metallb](https://metallb.universe.tf/installation/)
 - [srl-labs on github](https://github.com/srl-labs/srl-controller#readme)
 - [srlinux](https://learn.srlinux.dev/)
___
## Outro
___
Well, this was just a bare miminum and focused on how to set things up. I hope my post will help someone to start kicking the tyres with KNE. I also hope the project gets traction and evolves since the applications of it seem endless :smile: from all aspects. Thanking you, for reading the post, as well as all people sharing and contributing to the community making it sustainable and strong.


<p align="right">...till next time...<em>have fun!</em></p>


