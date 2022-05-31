---
title: "Kube my router up! - Part Two"
subtitle: "Setup a 3 node k8s cluster with kubeadm"
date: 2022-05-31T12:40:24+03:00
lastmod: 2022-06-01T00:00:00+03:00
draft: false
tags: [k8s, kubeadm, Ubuntu]
categories: [k8s]
toc:
  enable: true
resources:
- name: "featured-image"
  src: "preview.png"
- name: "featured-image-preview"
  src: "featured-image-preview.png"
author: false
summary: "This is the second part of a three-part blog post around google’s Kubernetes based Network Emulation (KNE) software. In this part, I am showing how to deploy a k8s cluster with a single control node using kubeadm over the VMs created during the first part."
---
## [Intro](/posts/kube-my-router-pt1/#intro)
___
## [Part One - Setting up the k8s VMs in EVE-NG](/posts/kube-my-router-pt1/)
___
## [Part Two - Deploying the k8s cluster with kubeadm](/posts/kube-my-router-pt2/)
___
### The Intent
  - Deploy k8s cluster with kubeadm
  - Single control plane, two workers
  - Use CRI-O as the container runtime
  - Flannel as network overlay CNI plugin
___
Let's change gears now and deploy the k8s cluster on the three VMs that are running on the two EVE-NG servers. Here's what we have up and running:
|EVE-NG node | Role | VM name | IP address | CPU | RAM |
|:---:|:---:|:---:|:---:|:---:|:---:|
| eve-01 | control-node | kates-control | 192.168.1.30 | 4 | 4096 |
| eve-01 | worker | kates-node-01 | 192.168.1.31 | 8 | 28672 |
| eve-02 | worker | kates-node-02 | 192.168.1.32 | 8 | 28672 |

We are going to deploy a single control node with two workers using kubeadm and also use the CRI-O container runtime.
___
### Prepare all nodes for kubeadm
___
In all nodes, fix the <mark>/etc/hosts</mark> since we are not using proper DNS resolution and we need to statically be able to resolve. 

```diff
$ diff /etc/hosts.orig /etc/hosts -p
*** /etc/hosts.orig     2022-05-30 19:28:32.679321412 +0000
--- /etc/hosts  2022-05-30 19:29:04.931472825 +0000
***************
*** 1,4 ****
--- 1,7 ----
  127.0.0.1 localhost
+ 192.168.1.30 kates-control
+ 192.168.1.31 kates-node-01
+ 192.168.1.32 kates-node-02

```
Install the pre-requisite packages if missing and add the k8s sources in apt.

```bash
$ sudo apt -y install vim git curl wget apt-transport-https

$ curl -s https://packages.cloud.google.com/apt/doc/apt-key.gpg | sudo apt-key add -
OK

$ echo "deb https://apt.kubernetes.io/ kubernetes-xenial main" | sudo tee /etc/apt/sources.list.d/kubernetes.list
deb https://apt.kubernetes.io/ kubernetes-xenial main

$ sudo apt update
```
You may upgrade any packages needed after the last apt update.

Next, we are now ready to install **kubeadm** along with **kubelet** and **kubectl** packages

```bash
$ sudo apt -y install kubeadm kubelet kubectl

# Lock the software version on these packages to avoid any accidental upgrade
$ sudo apt-mark hold kubelet kubeadm kubectl

# This is the version used while I was deploying
$ kubectl version --output=yaml --client && kubeadm version -o yaml
clientVersion:
  buildDate: "2022-05-24T12:26:19Z"
  compiler: gc
  gitCommit: 3ddd0f45aa91e2f30c70734b175631bec5b5825a
  gitTreeState: clean
  gitVersion: v1.24.1
  goVersion: go1.18.2
  major: "1"
  minor: "24"
  platform: linux/amd64
kustomizeVersion: v4.5.4

clientVersion:
  buildDate: "2022-05-24T12:24:38Z"
  compiler: gc
  gitCommit: 3ddd0f45aa91e2f30c70734b175631bec5b5825a
  gitTreeState: clean
  gitVersion: v1.24.1
  goVersion: go1.18.2
  major: "1"
  minor: "24"
  platform: linux/amd64
```
{{< admonition type=note title="Specific Version" open=true >}}
If you want to deploy a specific version of the packages and not the latest available you could execute:

```bash
$ sudo apt list -a kubelet kubeadm kubectl | grep 1.22.2

WARNING: apt does not have a stable CLI interface. Use with caution in scripts.

kubeadm/kubernetes-xenial 1.22.2-00 amd64
kubectl/kubernetes-xenial 1.22.2-00 amd64
kubelet/kubernetes-xenial 1.22.2-00 amd64
```
And then install with:
```bash
sudo apt -y install kubeadm=1.22.2-00 kubelet=1.22.2-00 kubectl=1.22.2-00
```
Remember that if you are using a specific version you will have to specify that while downloading the k8s images and during kubeadm bootstrap of the control node.
{{< /admonition >}}

We now need to disable swap if we are using any (cloud images do not by default), since kubelet will not run unless swap is disabled.

```bash
$ sudo swapoff -a

# Comment out the relevant line in fstab to disable swap from loading on boot (usually last line)
$ sudo vi /etc/fstab
```
Enable kernel modules and bridge NF to iptables chains
```bash
ubuntu@kates-control:~$ sudo modprobe overlay
ubuntu@kates-control:~$ sudo modprobe br_netfilter
ubuntu@kates-control:~$ sudo tee /etc/sysctl.d/kubernetes.conf<<EOF
> net.bridge.bridge-nf-call-ip6tables = 1
> net.bridge.bridge-nf-call-iptables = 1
> net.ipv4.ip_forward = 1
> EOF
net.bridge.bridge-nf-call-ip6tables = 1
net.bridge.bridge-nf-call-iptables = 1
net.ipv4.ip_forward = 1
ubuntu@kates-control:~$

# Reload sysctl to apply changes
ubuntu@kates-control:~$ sudo sysctl --system
```
___
### Install a container runtime
___
As far as CRI, there are three options available. Go with either **docker**, **containerd** or use **CRI-O**. For this post we are going with CRI-O, so the first step is to add the repo as root to our nodes.

```bash
$ sudo -i
root# export OS=xUbuntu_20.04
root# export VERSION=1.24

root# echo "deb https://download.opensuse.org/repositories/devel:/kubic:/libcontainers:/stable/$OS/ /" > /etc/apt/sources.list.d/devel:kubic:libcontainers:stable.list

root# echo "deb http://download.opensuse.org/repositories/devel:/kubic:/libcontainers:/stable:/cri-o:/$VERSION/$OS/ /" > /etc/apt/sources.list.d/devel:kubic:libcontainers:stable:cri-o:$VERSION.list

root# curl -L https://download.opensuse.org/repositories/devel:kubic:libcontainers:stable:cri-o:$VERSION/$OS/Release.key | apt-key add -
OK

root# curl -L https://download.opensuse.org/repositories/devel:/kubic:/libcontainers:/stable/$OS/Release.key | apt-key add -
OK
```
And now back as user, we can install the packages.

```bash
root# exit
logout
$ sudo apt update

$ sudo apt install -y cri-o cri-o-runc cri-tools
```
Configure the subnet for the pod network. I used 10.244.0.0/16 since we are going to use Flannel CNI later on.
```yaml {hl_lines=[6,17]}
$ cat /etc/cni/net.d/100-crio-bridge.conf
{
    "cniVersion": "0.3.1",
    "name": "crio",
    "type": "bridge",
    "bridge": "cni0",
    "isGateway": true,
    "ipMasq": true,
    "hairpinMode": true,
    "ipam": {
        "type": "host-local",
        "routes": [
            { "dst": "0.0.0.0/0" },
            { "dst": "1100:200::1/24" }
        ],
        "ranges": [
            [{ "subnet": "10.244.0.0/16" }],
            [{ "subnet": "1100:200::/24" }]
        ]
    }
}
```
Enable and start the service.
```bash
$ sudo systemctl enable crio
Created symlink /etc/systemd/system/cri-o.service → /lib/systemd/system/crio.service.
Created symlink /etc/systemd/system/multi-user.target.wants/crio.service → /lib/systemd/system/crio.service.

$ sudo systemctl start crio

# Check the status of the service
$ sudo systemctl status crio
● crio.service - Container Runtime Interface for OCI (CRI-O)
     Loaded: loaded (/lib/systemd/system/crio.service; enabled; vendor preset: enabled)
     Active: active (running) since Mon 2022-05-30 21:08:26 UTC; 5s ago
       Docs: https://github.com/cri-o/cri-o
   Main PID: 17373 (crio)
      Tasks: 10
     Memory: 12.3M
     CGroup: /system.slice/crio.service
             └─17373 /usr/bin/crio

< ...omitted...>

# Cri-o tools are working
$ sudo crictl info
{
  "status": {
    "conditions": [
      {
        "type": "RuntimeReady",
        "status": true,
        "reason": "",
        "message": ""
      },
      {
        "type": "NetworkReady",
        "status": true,
        "reason": "",
        "message": ""
      }
    ]
  }
}

# Pull an image to verify
$ sudo crictl pull ubuntu
Image is up to date for docker.io/library/ubuntu@sha256:26c68657ccce2cb0a31b330cb0be2b5e108d467f641c62e13ab40cbec258c68d

$ sudo crictl images
IMAGE                      TAG                 IMAGE ID            SIZE
docker.io/library/ubuntu   latest              d2e4e1f511320       80.3MB

$ sudo crictl rmi ubuntu
Deleted: docker.io/library/ubuntu:latest
```
{{< admonition type=note title="Access via proxy" open=true >}}
If you are behind a proxy, you can expose the proxy environment variables to the daemon.

```bash
$ sudo mkdir /etc/systemd/system/cri-o.service.d/

$ sudo tee /etc/systemd/system/cri-o.service.d/http-proxy.conf<<EOF
> [Service]
> Environment="HTTP_PROXY=http://<your_proxy>:<port>"
> Environment="HTTPS_PROXY=http://<your_proxy>:<port>"
> Environment="NO_PROXY=localhost,127.0.0.1,.domain.com"
> EOF

$ sudo systemctl daemon-reload
$ sudo systemctl restart crio
```
**NOTE:** The __no_proxy__ variable will not accept subnet masks, only full /32 ip addresses.
{{< /admonition >}}

___
### Bootstrap k8s control node
___
We are ready now to initialise the control node. First we need to enable the **kubelet** service

```bash
ubuntu@kates-control:~$ sudo systemctl enable kubelet

```
No worries if the service does not load correctly, it will, after kubeadm finishes configuring the control node.
Download k8s images from the registry, optionally, specifying the k8s version
```bash
# Check for the images first
ubuntu@kates-control:~$ sudo kubeadm config images list --kubernetes-version stable-1.24
k8s.gcr.io/kube-apiserver:v1.24.1
k8s.gcr.io/kube-controller-manager:v1.24.1
k8s.gcr.io/kube-scheduler:v1.24.1
k8s.gcr.io/kube-proxy:v1.24.1
k8s.gcr.io/pause:3.7
k8s.gcr.io/etcd:3.5.3-0
k8s.gcr.io/coredns/coredns:v1.8.6

# and then pull them
ubuntu@kates-control:~$ sudo kubeadm config images pull --kubernetes-version stable-1.24
[config/images] Pulled k8s.gcr.io/kube-apiserver:v1.24.1
[config/images] Pulled k8s.gcr.io/kube-controller-manager:v1.24.1
[config/images] Pulled k8s.gcr.io/kube-scheduler:v1.24.1
[config/images] Pulled k8s.gcr.io/kube-proxy:v1.24.1
[config/images] Pulled k8s.gcr.io/pause:3.7
[config/images] Pulled k8s.gcr.io/etcd:3.5.3-0
[config/images] Pulled k8s.gcr.io/coredns/coredns:v1.8.6

ubuntu@kates-control:~$ sudo crictl images
IMAGE                                TAG                 IMAGE ID            SIZE
k8s.gcr.io/coredns/coredns           v1.8.6              a4ca41631cc7a       47MB
k8s.gcr.io/etcd                      3.5.3-0             aebe758cef4cd       301MB
k8s.gcr.io/kube-apiserver            v1.24.1             e9f4b425f9192       131MB
k8s.gcr.io/kube-controller-manager   v1.24.1             b4ea7e648530d       121MB
k8s.gcr.io/kube-proxy                v1.24.1             beb86f5d8e6cd       112MB
k8s.gcr.io/kube-scheduler            v1.24.1             18688a72645c5       52.3MB
k8s.gcr.io/pause
```
Now we can use kubeadm to bootstrap the node setting the POD network and, again, by optionally specifying the version. The init process will get the appropriate images if they do not exist locally already.
```bash
ubuntu@kates-control:~$ sudo kubeadm init --pod-network-cidr=10.244.0.0/16 --kubernetes-version stable-1.24
[init] Using Kubernetes version: v1.24.1
[preflight] Running pre-flight checks
[preflight] Pulling images required for setting up a Kubernetes cluster
[preflight] This might take a minute or two, depending on the speed of your internet connection
[preflight] You can also perform this action in beforehand using 'kubeadm config images pull'
[certs] Using certificateDir folder "/etc/kubernetes/pki"
[certs] Generating "ca" certificate and key
[certs] Generating "apiserver" certificate and key
[certs] apiserver serving cert is signed for DNS names [kates-control kubernetes kubernetes.default kubernetes.default.svc kubernetes.default.svc.cluster.local] and IPs [10.96.0.1 192.168.1.30]
[certs] Generating "apiserver-kubelet-client" certificate and key
[certs] Generating "front-proxy-ca" certificate and key
[certs] Generating "front-proxy-client" certificate and key
[certs] Generating "etcd/ca" certificate and key
[certs] Generating "etcd/server" certificate and key
[certs] etcd/server serving cert is signed for DNS names [kates-control localhost] and IPs [192.168.1.30 127.0.0.1 ::1]
[certs] Generating "etcd/peer" certificate and key
[certs] etcd/peer serving cert is signed for DNS names [kates-control localhost] and IPs [192.168.1.30 127.0.0.1 ::1]
[certs] Generating "etcd/healthcheck-client" certificate and key
[certs] Generating "apiserver-etcd-client" certificate and key
[certs] Generating "sa" key and public key
[kubeconfig] Using kubeconfig folder "/etc/kubernetes"
[kubeconfig] Writing "admin.conf" kubeconfig file
[kubeconfig] Writing "kubelet.conf" kubeconfig file
[kubeconfig] Writing "controller-manager.conf" kubeconfig file
[kubeconfig] Writing "scheduler.conf" kubeconfig file
[kubelet-start] Writing kubelet environment file with flags to file "/var/lib/kubelet/kubeadm-flags.env"
[kubelet-start] Writing kubelet configuration to file "/var/lib/kubelet/config.yaml"
[kubelet-start] Starting the kubelet
[control-plane] Using manifest folder "/etc/kubernetes/manifests"
[control-plane] Creating static Pod manifest for "kube-apiserver"
[control-plane] Creating static Pod manifest for "kube-controller-manager"
[control-plane] Creating static Pod manifest for "kube-scheduler"
[etcd] Creating static Pod manifest for local etcd in "/etc/kubernetes/manifests"
[wait-control-plane] Waiting for the kubelet to boot up the control plane as static Pods from directory "/etc/kubernetes/manifests". This can take up to 4m0s
[apiclient] All control plane components are healthy after 11.504090 seconds
[upload-config] Storing the configuration used in ConfigMap "kubeadm-config" in the "kube-system" Namespace
[kubelet] Creating a ConfigMap "kubelet-config" in namespace kube-system with the configuration for the kubelets in the cluster
[upload-certs] Skipping phase. Please see --upload-certs
[mark-control-plane] Marking the node kates-control as control-plane by adding the labels: [node-role.kubernetes.io/control-plane node.kubernetes.io/exclude-from-external-load-balancers]
[mark-control-plane] Marking the node kates-control as control-plane by adding the taints [node-role.kubernetes.io/master:NoSchedule node-role.kubernetes.io/control-plane:NoSchedule]
[bootstrap-token] Using token: qqjcl5.bj2j9wjcmr5dphiw
[bootstrap-token] Configuring bootstrap tokens, cluster-info ConfigMap, RBAC Roles
[bootstrap-token] Configured RBAC rules to allow Node Bootstrap tokens to get nodes
[bootstrap-token] Configured RBAC rules to allow Node Bootstrap tokens to post CSRs in order for nodes to get long term certificate credentials
[bootstrap-token] Configured RBAC rules to allow the csrapprover controller automatically approve CSRs from a Node Bootstrap Token
[bootstrap-token] Configured RBAC rules to allow certificate rotation for all node client certificates in the cluster
[bootstrap-token] Creating the "cluster-info" ConfigMap in the "kube-public" namespace
[kubelet-finalize] Updating "/etc/kubernetes/kubelet.conf" to point to a rotatable kubelet client certificate and key
[addons] Applied essential addon: CoreDNS
[addons] Applied essential addon: kube-proxy

Your Kubernetes control-plane has initialized successfully!

To start using your cluster, you need to run the following as a regular user:

  mkdir -p $HOME/.kube
  sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
  sudo chown $(id -u):$(id -g) $HOME/.kube/config

Alternatively, if you are the root user, you can run:

  export KUBECONFIG=/etc/kubernetes/admin.conf

You should now deploy a pod network to the cluster.
Run "kubectl apply -f [podnetwork].yaml" with one of the options listed at:
  https://kubernetes.io/docs/concepts/cluster-administration/addons/

Then you can join any number of worker nodes by running the following on each as root:

kubeadm join 192.168.1.30:6443 --token qqjcl5.bj2j9wjcmr5dphiw \
        --discovery-token-ca-cert-hash sha256:42a47eb0e4872ebdd7ebbd6935a6e1c42f51a67d29d80fd53098d27323c59b2e
```
{{< admonition type=tip title="Join Token" open=true >}}
The join token created by kubeadm will last I think for 24hrs, so if you are joining workers sooner you could copy the join command in a text pad or something for later use.
{{< /admonition >}}
Now as instructed by the init process, copy the admin.conf into your users directory in order to be able to use kubectl to operate your cluster.

```bash
ubuntu@kates-control:~$ mkdir -p $HOME/.kube
ubuntu@kates-control:~$   sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
ubuntu@kates-control:~$   sudo chown $(id -u):$(id -g) $HOME/.kube/config
```
And run some kubectl to check your control-plane
```bash
ubuntu@kates-control:~$ kubectl cluster-info
Kubernetes control plane is running at https://192.168.1.30:6443
CoreDNS is running at https://192.168.1.30:6443/api/v1/namespaces/kube-system/services/kube-dns:dns/proxy

To further debug and diagnose cluster problems, use 'kubectl cluster-info dump'.

ubuntu@kates-control:~$ kubectl get nodes -owide
NAME            STATUS   ROLES           AGE     VERSION   INTERNAL-IP    EXTERNAL-IP   OS-IMAGE             KERNEL-VERSION      CONTAINER-RUNTIME
kates-control   Ready    control-plane   6m52s   v1.24.1   192.168.1.30   <none>        Ubuntu 20.04.4 LTS   5.4.0-113-generic   cri-o://1.24.0


ubuntu@kates-control:~$ kubectl get all -A
NAMESPACE     NAME                                        READY   STATUS    RESTARTS   AGE
kube-system   pod/coredns-6d4b75cb6d-ps84c                1/1     Running   0          11m
kube-system   pod/coredns-6d4b75cb6d-rm2z8                1/1     Running   0          11m
kube-system   pod/etcd-kates-control                      1/1     Running   0          11m
kube-system   pod/kube-apiserver-kates-control            1/1     Running   0          11m
kube-system   pod/kube-controller-manager-kates-control   1/1     Running   0          11m
kube-system   pod/kube-proxy-sczsq                        1/1     Running   0          11m
kube-system   pod/kube-scheduler-kates-control            1/1     Running   0          11m

NAMESPACE     NAME                 TYPE        CLUSTER-IP   EXTERNAL-IP   PORT(S)                  AGE
default       service/kubernetes   ClusterIP   10.96.0.1    <none>        443/TCP                  11m
kube-system   service/kube-dns     ClusterIP   10.96.0.10   <none>        53/UDP,53/TCP,9153/TCP   11m

NAMESPACE     NAME                        DESIRED   CURRENT   READY   UP-TO-DATE   AVAILABLE   NODE SELECTOR            AGE
kube-system   daemonset.apps/kube-proxy   1         1         1       1            1           kubernetes.io/os=linux   11m

NAMESPACE     NAME                      READY   UP-TO-DATE   AVAILABLE   AGE
kube-system   deployment.apps/coredns   2/2     2            2           11m

NAMESPACE     NAME                                 DESIRED   CURRENT   READY   AGE
kube-system   replicaset.apps/coredns-6d4b75cb6d   2         2         2       11m


ubuntu@kates-control:~$ kubectl get events -A
NAMESPACE     LAST SEEN   TYPE      REASON                    OBJECT                          MESSAGE
default       9m5s        Normal    Starting                  node/kates-control              Starting kubelet.
default       9m5s        Normal    NodeHasSufficientMemory   node/kates-control              Node kates-control status is now: NodeHasSufficientMemory
default       9m5s        Normal    NodeHasNoDiskPressure     node/kates-control              Node kates-control status is now: NodeHasNoDiskPressure
default       9m5s        Normal    NodeHasSufficientPID      node/kates-control              Node kates-control status is now: NodeHasSufficientPID
default       9m5s        Normal    NodeAllocatableEnforced   node/kates-control              Updated Node Allocatable limit across pods
default       8m53s       Normal    Starting                  node/kates-control              Starting kubelet.
default       8m53s       Normal    NodeHasSufficientMemory   node/kates-control              Node kates-control status is now: NodeHasSufficientMemory
default       8m53s       Normal    NodeHasNoDiskPressure     node/kates-control              Node kates-control status is now: NodeHasNoDiskPressure
default       8m53s       Normal    NodeHasSufficientPID      node/kates-control              Node kates-control status is now: NodeHasSufficientPID
default       8m52s       Normal    NodeAllocatableEnforced   node/kates-control              Updated Node Allocatable limit across pods
default       8m42s       Normal    NodeReady                 node/kates-control              Node kates-control status is now: NodeReady
default       8m40s       Normal    RegisteredNode            node/kates-control              Node kates-control event: Registered Node kates-control in Controller
default       8m39s       Normal    Starting                  node/kates-control
kube-system   8m39s       Normal    Scheduled                 pod/coredns-6d4b75cb6d-ps84c    Successfully assigned kube-system/coredns-6d4b75cb6d-ps84c to kates-control
kube-system   8m37s       Normal    Pulled                    pod/coredns-6d4b75cb6d-ps84c    Container image "k8s.gcr.io/coredns/coredns:v1.8.6" already present on machine
kube-system   8m37s       Normal    Created                   pod/coredns-6d4b75cb6d-ps84c    Created container coredns
kube-system   8m37s       Normal    Started                   pod/coredns-6d4b75cb6d-ps84c    Started container coredns
kube-system   8m39s       Normal    Scheduled                 pod/coredns-6d4b75cb6d-rm2z8    Successfully assigned kube-system/coredns-6d4b75cb6d-rm2z8 to kates-control
kube-system   8m37s       Normal    Pulled                    pod/coredns-6d4b75cb6d-rm2z8    Container image "k8s.gcr.io/coredns/coredns:v1.8.6" already present on machine
kube-system   8m37s       Normal    Created                   pod/coredns-6d4b75cb6d-rm2z8    Created container coredns
kube-system   8m37s       Normal    Started                   pod/coredns-6d4b75cb6d-rm2z8    Started container coredns
kube-system   8m39s       Normal    SuccessfulCreate          replicaset/coredns-6d4b75cb6d   Created pod: coredns-6d4b75cb6d-rm2z8
kube-system   8m39s       Normal    SuccessfulCreate          replicaset/coredns-6d4b75cb6d   Created pod: coredns-6d4b75cb6d-ps84c
kube-system   8m39s       Normal    ScalingReplicaSet         deployment/coredns              Scaled up replica set coredns-6d4b75cb6d to 2
kube-system   8m53s       Normal    LeaderElection            lease/kube-controller-manager   kates-control_be10ca29-7103-41b0-affc-d7e525805256 became leader
kube-system   8m40s       Normal    Scheduled                 pod/kube-proxy-sczsq            Successfully assigned kube-system/kube-proxy-sczsq to kates-control
kube-system   8m40s       Warning   FailedMount               pod/kube-proxy-sczsq            MountVolume.SetUp failed for volume "kube-api-access-dkswb" : configmap "kube-root-ca.crt" not found
kube-system   8m39s       Normal    Pulled                    pod/kube-proxy-sczsq            Container image "k8s.gcr.io/kube-proxy:v1.24.1" already present on machine
kube-system   8m39s       Normal    Created                   pod/kube-proxy-sczsq            Created container kube-proxy
kube-system   8m39s       Normal    Started                   pod/kube-proxy-sczsq            Started container kube-proxy
kube-system   8m40s       Normal    SuccessfulCreate          daemonset/kube-proxy            Created pod: kube-proxy-sczsq
kube-system   8m52s       Normal    LeaderElection            lease/kube-scheduler            kates-control_c16cc7c1-ef13-46be-8e19-04d385a36753 became leader

# ConfigMaps are in place
ubuntu@kates-control:~$ kubectl get cm -A
NAMESPACE         NAME                                 DATA   AGE
default           kube-root-ca.crt                     1      11m
kube-node-lease   kube-root-ca.crt                     1      11m
kube-public       cluster-info                         2      12m
kube-public       kube-root-ca.crt                     1      11m
kube-system       coredns                              1      12m
kube-system       extension-apiserver-authentication   6      12m
kube-system       kube-proxy                           2      12m
kube-system       kube-root-ca.crt                     1      11m
kube-system       kubeadm-config                       1      12m
kube-system       kubelet-config                       1      12m

# componentstatus seems old :smile:
ubuntu@kates-control:~$ kubectl get cs -A
Warning: v1 ComponentStatus is deprecated in v1.19+
NAME                 STATUS    MESSAGE                         ERROR
controller-manager   Healthy   ok
scheduler            Healthy   ok
etcd-0               Healthy   {"health":"true","reason":""}

```
Let's also check the network side
```bash
ubuntu@kates-control:~$ ip link
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
2: ens3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP mode DEFAULT group default qlen 1000
    link/ether 00:50:00:00:01:00 brd ff:ff:ff:ff:ff:ff
3: cni0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP mode DEFAULT group default qlen 1000
    link/ether 16:51:fd:c4:95:8a brd ff:ff:ff:ff:ff:ff
4: veth856110c9@if3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue master cni0 state UP mode DEFAULT group default
    link/ether 16:51:fd:c4:95:8a brd ff:ff:ff:ff:ff:ff link-netns fc79400f-30c0-4e2b-9ab5-89faa6ba92fb
5: veth6457e1d3@if3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue master cni0 state UP mode DEFAULT group default
    link/ether 86:b4:08:35:34:c6 brd ff:ff:ff:ff:ff:ff link-netns 175ebea7-4078-49e8-b212-ffb83275abb4

ubuntu@kates-control:~$ ip ro
default via 192.168.1.1 dev ens3 proto static
10.244.0.0/16 dev cni0 proto kernel scope link src 10.244.0.1
192.168.1.0/24 dev ens3 proto kernel scope link src 192.168.1.30

ubuntu@kates-control:~$ ip netns
175ebea7-4078-49e8-b212-ffb83275abb4 (id: 1)
fc79400f-30c0-4e2b-9ab5-89faa6ba92fb (id: 0)
a62d2b36-dade-44ca-a73e-394b21f6353a
c2a50064-2236-4c9e-9348-a31db8989875
d4f682be-5930-4ae2-a01d-2e8f31633b42
f669bbf0-33a9-436c-a5a4-6aa015846c0b
f66f64ea-4731-48f3-8d20-c9519e140226

ubuntu@kates-control:~$ lsns --output-all
        NS TYPE   PATH                   NPROCS    PID PPID COMMAND                      UID USER      NETNSID NSFS
4026531835 cgroup /proc/118794/ns/cgroup      3 118794    1 /lib/systemd/systemd --user 1000 ubuntu
4026531836 pid    /proc/118794/ns/pid         3 118794    1 /lib/systemd/systemd --user 1000 ubuntu
4026531837 user   /proc/118794/ns/user        3 118794    1 /lib/systemd/systemd --user 1000 ubuntu
4026531838 uts    /proc/118794/ns/uts         3 118794    1 /lib/systemd/systemd --user 1000 ubuntu
4026531839 ipc    /proc/118794/ns/ipc         3 118794    1 /lib/systemd/systemd --user 1000 ubuntu
4026531840 mnt    /proc/118794/ns/mnt         3 118794    1 /lib/systemd/systemd --user 1000 ubuntu
4026531992 net    /proc/118794/ns/net         3 118794    1 /lib/systemd/systemd --user 1000 ubuntu unassigned /run/netns/f66f64ea-4731-48f3-8d20-c9519e140226
                                                                                                               /run/netns/f669bbf0-33a9-436c-a5a4-6aa015846c0b
                                                                                                               /run/netns/d4f682be-5930-4ae2-a01d-2e8f31633b42
                                                                                                               /run/netns/c2a50064-2236-4c9e-9348-a31db8989875
                                                                                                               /run/netns/a62d2b36-dade-44ca-a73e-394b21f6353a
```
___
### Install network CNI
___
Now, still on the control node, we are going to deploy the Flannel CNI plugin. First save the manifest localy and replace the bridge interface name with the correct one on the node.
```bash
ubuntu@kates-control:~$ wget https://raw.githubusercontent.com/coreos/flannel/master/Documentation/kube-flannel.yml

ubuntu@kates-control:~$ cp kube-flannel.yml kube-flannel.yml.orig

ubuntu@kates-control:~$ sed -i 's/cbr0/cni0/g' kube-flannel.yml
```
```diff
ubuntu@kates-control:~$ diff -c kube-flannel.yml.orig kube-flannel.yml
*** kube-flannel.yml.orig       2022-05-31 11:49:45.829901474 +0000
--- kube-flannel.yml    2022-05-31 11:52:03.165836343 +0000
***************
*** 105,111 ****
  data:
    cni-conf.json: |
      {
!       "name": "cbr0",
        "cniVersion": "0.3.1",
        "plugins": [
          {
--- 105,111 ----
  data:
    cni-conf.json: |
      {
!       "name": "cni0",
        "cniVersion": "0.3.1",
        "plugins": [
          {
```
Deploy flannel from the altered file.
```bash
ubuntu@kates-control:~$ kubectl apply -f kube-flannel.yml
Warning: policy/v1beta1 PodSecurityPolicy is deprecated in v1.21+, unavailable in v1.25+
podsecuritypolicy.policy/psp.flannel.unprivileged created
clusterrole.rbac.authorization.k8s.io/flannel created
clusterrolebinding.rbac.authorization.k8s.io/flannel created
serviceaccount/flannel created
configmap/kube-flannel-cfg created
daemonset.apps/kube-flannel-ds created
ubuntu@kates-control:~$ kubectl get all -A
NAMESPACE     NAME                                        READY   STATUS    RESTARTS   AGE
kube-system   pod/coredns-6d4b75cb6d-ps84c                1/1     Running   0          119m
kube-system   pod/coredns-6d4b75cb6d-rm2z8                1/1     Running   0          119m
kube-system   pod/etcd-kates-control                      1/1     Running   0          119m
kube-system   pod/kube-apiserver-kates-control            1/1     Running   0          119m
kube-system   pod/kube-controller-manager-kates-control   1/1     Running   0          119m
kube-system   pod/kube-flannel-ds-xdnlh                   1/1     Running   0          25s
kube-system   pod/kube-proxy-sczsq                        1/1     Running   0          119m
kube-system   pod/kube-scheduler-kates-control            1/1     Running   0          119m

NAMESPACE     NAME                 TYPE        CLUSTER-IP   EXTERNAL-IP   PORT(S)                  AGE
default       service/kubernetes   ClusterIP   10.96.0.1    <none>        443/TCP                  119m
kube-system   service/kube-dns     ClusterIP   10.96.0.10   <none>        53/UDP,53/TCP,9153/TCP   119m

NAMESPACE     NAME                             DESIRED   CURRENT   READY   UP-TO-DATE   AVAILABLE   NODE SELECTOR            AGE
kube-system   daemonset.apps/kube-flannel-ds   1         1         1       1            1           <none>                   25s
kube-system   daemonset.apps/kube-proxy        1         1         1       1            1           kubernetes.io/os=linux   119m

NAMESPACE     NAME                      READY   UP-TO-DATE   AVAILABLE   AGE
kube-system   deployment.apps/coredns   2/2     2            2           119m

NAMESPACE     NAME                                 DESIRED   CURRENT   READY   AGE
kube-system   replicaset.apps/coredns-6d4b75cb6d   2         2         2       119m
ubuntu@kates-control:~$ kubectl get events -A
NAMESPACE     LAST SEEN   TYPE     REASON             OBJECT                      MESSAGE
kube-system   43s         Normal   Scheduled          pod/kube-flannel-ds-xdnlh   Successfully assigned kube-system/kube-flannel-ds-xdnlh to kates-control
kube-system   43s         Normal   Pulling            pod/kube-flannel-ds-xdnlh   Pulling image "rancher/mirrored-flannelcni-flannel-cni-plugin:v1.1.0"
kube-system   36s         Normal   Pulled             pod/kube-flannel-ds-xdnlh   Successfully pulled image "rancher/mirrored-flannelcni-flannel-cni-plugin:v1.1.0" in 6.185270749s
kube-system   36s         Normal   Created            pod/kube-flannel-ds-xdnlh   Created container install-cni-plugin
kube-system   36s         Normal   Started            pod/kube-flannel-ds-xdnlh   Started container install-cni-plugin
kube-system   36s         Normal   Pulling            pod/kube-flannel-ds-xdnlh   Pulling image "rancher/mirrored-flannelcni-flannel:v0.18.0"
kube-system   28s         Normal   Pulled             pod/kube-flannel-ds-xdnlh   Successfully pulled image "rancher/mirrored-flannelcni-flannel:v0.18.0" in 7.54409527s
kube-system   28s         Normal   Created            pod/kube-flannel-ds-xdnlh   Created container install-cni
kube-system   28s         Normal   Started            pod/kube-flannel-ds-xdnlh   Started container install-cni
kube-system   28s         Normal   Pulled             pod/kube-flannel-ds-xdnlh   Container image "rancher/mirrored-flannelcni-flannel:v0.18.0" already present on machine
kube-system   28s         Normal   Created            pod/kube-flannel-ds-xdnlh   Created container kube-flannel
kube-system   28s         Normal   Started            pod/kube-flannel-ds-xdnlh   Started container kube-flannel
kube-system   43s         Normal   SuccessfulCreate   daemonset/kube-flannel-ds   Created pod: kube-flannel-ds-xdnlh
ubuntu@kates-control:~$

```
And from the network side
```bash
ubuntu@kates-control:~$ ip link
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
2: ens3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP mode DEFAULT group default qlen 1000
    link/ether 00:50:00:00:01:00 brd ff:ff:ff:ff:ff:ff
3: cni0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP mode DEFAULT group default qlen 1000
    link/ether 16:51:fd:c4:95:8a brd ff:ff:ff:ff:ff:ff
4: veth856110c9@if3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue master cni0 state UP mode DEFAULT group default
    link/ether 16:51:fd:c4:95:8a brd ff:ff:ff:ff:ff:ff link-netns fc79400f-30c0-4e2b-9ab5-89faa6ba92fb
5: veth6457e1d3@if3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue master cni0 state UP mode DEFAULT group default
    link/ether 86:b4:08:35:34:c6 brd ff:ff:ff:ff:ff:ff link-netns 175ebea7-4078-49e8-b212-ffb83275abb4
6: flannel.1: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1450 qdisc noqueue state UNKNOWN mode DEFAULT group default
    link/ether 52:a6:b3:68:b4:e4 brd ff:ff:ff:ff:ff:ff

ubuntu@kates-control:~$ ip ro
default via 192.168.1.1 dev ens3 proto static
10.244.0.0/16 dev cni0 proto kernel scope link src 10.244.0.1
192.168.1.0/24 dev ens3 proto kernel scope link src 192.168.1.30

ubuntu@kates-control:~$ ip add
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
    inet 127.0.0.1/8 scope host lo
       valid_lft forever preferred_lft forever
    inet6 ::1/128 scope host
       valid_lft forever preferred_lft forever
2: ens3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000
    link/ether 00:50:00:00:01:00 brd ff:ff:ff:ff:ff:ff
    inet 192.168.1.30/24 brd 192.168.1.255 scope global ens3
       valid_lft forever preferred_lft forever
    inet6 2a02:587:e443:cef3:250:ff:fe00:100/64 scope global dynamic mngtmpaddr noprefixroute
       valid_lft 604794sec preferred_lft 86394sec
    inet6 fe80::250:ff:fe00:100/64 scope link
       valid_lft forever preferred_lft forever
3: cni0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP group default qlen 1000
    link/ether 16:51:fd:c4:95:8a brd ff:ff:ff:ff:ff:ff
    inet 10.244.0.1/16 brd 10.244.255.255 scope global cni0
       valid_lft forever preferred_lft forever
    inet6 1100:200::1/24 scope global
       valid_lft forever preferred_lft forever
    inet6 fe80::3c3d:a9ff:fece:f36c/64 scope link
       valid_lft forever preferred_lft forever
4: veth856110c9@if3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue master cni0 state UP group default
    link/ether 16:51:fd:c4:95:8a brd ff:ff:ff:ff:ff:ff link-netns fc79400f-30c0-4e2b-9ab5-89faa6ba92fb
    inet6 fe80::1451:fdff:fec4:958a/64 scope link
       valid_lft forever preferred_lft forever
5: veth6457e1d3@if3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue master cni0 state UP group default
    link/ether 86:b4:08:35:34:c6 brd ff:ff:ff:ff:ff:ff link-netns 175ebea7-4078-49e8-b212-ffb83275abb4
    inet6 fe80::84b4:8ff:fe35:34c6/64 scope link
       valid_lft forever preferred_lft forever
6: flannel.1: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1450 qdisc noqueue state UNKNOWN group default
    link/ether 52:a6:b3:68:b4:e4 brd ff:ff:ff:ff:ff:ff
    inet 10.244.0.0/32 scope global flannel.1
       valid_lft forever preferred_lft forever
    inet6 fe80::50a6:b3ff:fe68:b4e4/64 scope link
       valid_lft forever preferred_lft forever

```
___
### Add worker nodes
___
Let's go and add the two other nodes to our cluster now. We can do this either by using the init token or we could create a new one.
```bash
ubuntu@kates-control:~$ kubeadm token create --print-join-command
kubeadm join 192.168.1.30:6443 --token r8ydn9.nkbo1b94w7a6s8em --discovery-token-ca-cert-hash sha256:42a47eb0e4872ebdd7ebbd6935a6e1c42f51a67d29d80fd53098d27323c59b2e
```
Now on both worker nodes.
```bash
ubuntu@kates-node-01:~$ sudo kubeadm join 192.168.1.30:6443 --token r8ydn9.nkbo1b94w7a6s8em --discovery-token-ca-cert-hash sha256:42a47eb0e4872ebdd7ebbd6935a6e1c42f51a67d29d80fd53098d27323c59b2e
[preflight] Running pre-flight checks
[preflight] Reading configuration from the cluster...
[preflight] FYI: You can look at this config file with 'kubectl -n kube-system get cm kubeadm-config -o yaml'
[kubelet-start] Writing kubelet configuration to file "/var/lib/kubelet/config.yaml"
[kubelet-start] Writing kubelet environment file with flags to file "/var/lib/kubelet/kubeadm-flags.env"
[kubelet-start] Starting the kubelet
[kubelet-start] Waiting for the kubelet to perform the TLS Bootstrap...

This node has joined the cluster:
* Certificate signing request was sent to apiserver and a response was received.
* The Kubelet was informed of the new secure connection details.

Run 'kubectl get nodes' on the control-plane to see this node join the cluster.

```
If all went well then we should have a 3 node k8s cluster :smile:
```bash
ubuntu@kates-control:~$ kubectl get nodes -owide
NAME            STATUS   ROLES           AGE     VERSION   INTERNAL-IP    EXTERNAL-IP   OS-IMAGE             KERNEL-VERSION      CONTAINER-RUNTIME
kates-control   Ready    control-plane   140m    v1.24.1   192.168.1.30   <none>        Ubuntu 20.04.4 LTS   5.4.0-113-generic   cri-o://1.24.0
kates-node-01   Ready    <none>          3m11s   v1.24.1   192.168.1.31   <none>        Ubuntu 20.04.4 LTS   5.4.0-113-generic   cri-o://1.24.0
kates-node-02   Ready    <none>          96s     v1.24.1   192.168.1.32   <none>        Ubuntu 20.04.4 LTS   5.4.0-113-generic   cri-o://1.24.0

```
Here's how the network looks like in all nodes.
```bash
ubuntu@kates-control:~$ ip ro
default via 192.168.1.1 dev ens3 proto static
10.244.0.0/16 dev cni0 proto kernel scope link src 10.244.0.1
10.244.1.0/24 via 10.244.1.0 dev flannel.1 onlink
10.244.2.0/24 via 10.244.2.0 dev flannel.1 onlink
192.168.1.0/24 dev ens3 proto kernel scope link src 192.168.1.30

ubuntu@kates-node-01:~$ ip ro
default via 192.168.1.1 dev ens3 proto static
10.244.0.0/24 via 10.244.0.0 dev flannel.1 onlink
10.244.2.0/24 via 10.244.2.0 dev flannel.1 onlink
192.168.1.0/24 dev ens3 proto kernel scope link src 192.168.1.31

ubuntu@kates-node-02:~$ ip ro
default via 192.168.1.1 dev ens3 proto static
10.244.0.0/24 via 10.244.0.0 dev flannel.1 onlink
10.244.1.0/24 via 10.244.1.0 dev flannel.1 onlink
192.168.1.0/24 dev ens3 proto kernel scope link src 192.168.1.32
```
```bash
ubuntu@kates-control:~$ ip add
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
    inet 127.0.0.1/8 scope host lo
       valid_lft forever preferred_lft forever
    inet6 ::1/128 scope host
       valid_lft forever preferred_lft forever
2: ens3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000
    link/ether 00:50:00:00:01:00 brd ff:ff:ff:ff:ff:ff
    inet 192.168.1.30/24 brd 192.168.1.255 scope global ens3
       valid_lft forever preferred_lft forever
    inet6 2a02:587:e443:cef3:250:ff:fe00:100/64 scope global dynamic mngtmpaddr noprefixroute
       valid_lft 604799sec preferred_lft 86399sec
    inet6 fe80::250:ff:fe00:100/64 scope link
       valid_lft forever preferred_lft forever
3: cni0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP group default qlen 1000
    link/ether 16:51:fd:c4:95:8a brd ff:ff:ff:ff:ff:ff
    inet 10.244.0.1/16 brd 10.244.255.255 scope global cni0
       valid_lft forever preferred_lft forever
    inet6 1100:200::1/24 scope global
       valid_lft forever preferred_lft forever
    inet6 fe80::3c3d:a9ff:fece:f36c/64 scope link
       valid_lft forever preferred_lft forever
4: veth856110c9@if3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue master cni0 state UP group default
    link/ether 16:51:fd:c4:95:8a brd ff:ff:ff:ff:ff:ff link-netns fc79400f-30c0-4e2b-9ab5-89faa6ba92fb
    inet6 fe80::1451:fdff:fec4:958a/64 scope link
       valid_lft forever preferred_lft forever
5: veth6457e1d3@if3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue master cni0 state UP group default
    link/ether 86:b4:08:35:34:c6 brd ff:ff:ff:ff:ff:ff link-netns 175ebea7-4078-49e8-b212-ffb83275abb4
    inet6 fe80::84b4:8ff:fe35:34c6/64 scope link
       valid_lft forever preferred_lft forever
6: flannel.1: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1450 qdisc noqueue state UNKNOWN group default
    link/ether 52:a6:b3:68:b4:e4 brd ff:ff:ff:ff:ff:ff
    inet 10.244.0.0/32 scope global flannel.1
       valid_lft forever preferred_lft forever
    inet6 fe80::50a6:b3ff:fe68:b4e4/64 scope link
       valid_lft forever preferred_lft forever

ubuntu@kates-node-01:~$ ip add
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
    inet 127.0.0.1/8 scope host lo
       valid_lft forever preferred_lft forever
    inet6 ::1/128 scope host
       valid_lft forever preferred_lft forever
2: ens3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000
    link/ether 00:50:00:00:02:00 brd ff:ff:ff:ff:ff:ff
    inet 192.168.1.31/24 brd 192.168.1.255 scope global ens3
       valid_lft forever preferred_lft forever
    inet6 2a02:587:e443:cef3:250:ff:fe00:200/64 scope global dynamic mngtmpaddr noprefixroute
       valid_lft 604743sec preferred_lft 86343sec
    inet6 fe80::250:ff:fe00:200/64 scope link
       valid_lft forever preferred_lft forever
3: flannel.1: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1450 qdisc noqueue state UNKNOWN group default
    link/ether 16:37:66:b0:c0:2b brd ff:ff:ff:ff:ff:ff
    inet 10.244.1.0/32 scope global flannel.1
       valid_lft forever preferred_lft forever
    inet6 fe80::1437:66ff:feb0:c02b/64 scope link
       valid_lft forever preferred_lft forever

ubuntu@kates-node-02:~$ ip add
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
    inet 127.0.0.1/8 scope host lo
       valid_lft forever preferred_lft forever
    inet6 ::1/128 scope host
       valid_lft forever preferred_lft forever
2: ens3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000
    link/ether 00:60:00:00:01:00 brd ff:ff:ff:ff:ff:ff
    inet 192.168.1.32/24 brd 192.168.1.255 scope global ens3
       valid_lft forever preferred_lft forever
    inet6 2a02:587:e443:cef3:260:ff:fe00:100/64 scope global dynamic mngtmpaddr noprefixroute
       valid_lft 604783sec preferred_lft 86383sec
    inet6 fe80::260:ff:fe00:100/64 scope link
       valid_lft forever preferred_lft forever
3: flannel.1: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1450 qdisc noqueue state UNKNOWN group default
    link/ether 4e:3e:a1:6d:ef:f9 brd ff:ff:ff:ff:ff:ff
    inet 10.244.2.0/32 scope global flannel.1
       valid_lft forever preferred_lft forever
    inet6 fe80::4c3e:a1ff:fe6d:eff9/64 scope link
       valid_lft forever preferred_lft forever

```
{{< admonition type=note title="Where is cni0" open=true >}}
You might have noticed that cni0 bridge is missing on the worker nodes, but it will be created once pods are schduled on the nodes.
{{< /admonition >}}
Final touch is to set the _worker_ role to the workers and, if you like to run pods on the control node as well, untaint the node.
```bash
ubuntu@kates-control:~$ kubectl get nodes
NAME            STATUS   ROLES           AGE     VERSION
kates-control   Ready    control-plane   4h37m   v1.24.1
kates-node-01   Ready    <none>          139m    v1.24.1
kates-node-02   Ready    <none>          138m    v1.24.1

ubuntu@kates-control:~$ kubectl label nodes kates-node-01 kubernetes.io/role=worker
node/kates-node-01 labeled

ubuntu@kates-control:~$ kubectl label nodes kates-node-02 kubernetes.io/role=worker
node/kates-node-02 labeled

ubuntu@kates-control:~$ kubectl get nodes
NAME            STATUS   ROLES           AGE     VERSION
kates-control   Ready    control-plane   4h37m   v1.24.1
kates-node-01   Ready    worker          140m    v1.24.1
kates-node-02   Ready    worker          138m    v1.24.1
ubuntu@kates-control:~$

# Untaint the control plane to run pods
ubuntu@kates-control:~$ kubectl taint nodes kates-control node-role.kubernetes.io/control-plane=:NoSchedule- node-role.kubernetes.io/master=:NoSchedule-
node/kates-control untainted
```





___
### Testing applications
___
Let's deploy a test application to verify the cluster is running fine. We can create a deployment of nginx demo image with three replicas and test connectivity. The three pods will normaly be distributed across the three nodes, so we can use a Loadbalancer service to expose the deployment and check the operation.

```bash {hl_lines=["8-10",28]}
# Create a 3 replica deployment of nginx demo image
ubuntu@kates-control:~$ kubectl create deployment web --image=nginxdemos/hello  --replicas=3  --port 80
deployment.apps/web created

# Check to see that pods are distributed across the three nodes
ubuntu@kates-control:~$ kubectl get all -owide
NAME                       READY   STATUS    RESTARTS   AGE   IP            NODE            NOMINATED NODE   READINESS GATES
pod/web-54b75887bb-58x8z   1/1     Running   0          52s   10.244.1.20   kates-node-01   <none>           <none>
pod/web-54b75887bb-8sqbx   1/1     Running   0          52s   10.244.2.20   kates-node-02   <none>           <none>
pod/web-54b75887bb-rjbgk   1/1     Running   0          52s   10.244.0.10   kates-control   <none>           <none>

NAME                 TYPE        CLUSTER-IP   EXTERNAL-IP   PORT(S)   AGE   SELECTOR
service/kubernetes   ClusterIP   10.96.0.1    <none>        443/TCP   10h   <none>

NAME                  READY   UP-TO-DATE   AVAILABLE   AGE   CONTAINERS   IMAGES             SELECTOR
deployment.apps/web   3/3     3            3           52s   hello        nginxdemos/hello   app=web

NAME                             DESIRED   CURRENT   READY   AGE   CONTAINERS   IMAGES             SELECTOR
replicaset.apps/web-54b75887bb   3         3         3       52s   hello        nginxdemos/hello   app=web,pod-template-hash=54b75887bb

# Create a LoadBalancer service
ubuntu@kates-control:~$ kubectl expose deployment web --type=LoadBalancer --name=web-service
service/web-service exposed

ubuntu@kates-control:~$ kubectl get svc -o wide
NAME          TYPE           CLUSTER-IP       EXTERNAL-IP   PORT(S)        AGE   SELECTOR
kubernetes    ClusterIP      10.96.0.1        <none>        443/TCP        10h   <none>
web-service   LoadBalancer   10.111.136.202   <pending>     80:30822/TCP   22s   app=web

# Test communication to each pod
ubuntu@kates-control:~$ curl -s 10.244.1.20 | grep Server
<p><span>Server&nbsp;address:</span> <span>10.244.1.20:80</span></p>
<p><span>Server&nbsp;name:</span> <span>web-54b75887bb-58x8z</span></p>

ubuntu@kates-control:~$ curl -s 10.244.2.20 | grep Server
<p><span>Server&nbsp;address:</span> <span>10.244.2.20:80</span></p>
<p><span>Server&nbsp;name:</span> <span>web-54b75887bb-8sqbx</span></p>

ubuntu@kates-control:~$ curl -s 10.244.0.10 | grep Server
<p><span>Server&nbsp;address:</span> <span>10.244.0.10:80</span></p>
<p><span>Server&nbsp;name:</span> <span>web-54b75887bb-rjbgk</span></p>

# Now test on the exposed port on the k8s hosts
ubuntu@kates-control:~$ for server in kates-control kates-node-01 kates-node-02 ; \
>     do  \
>         echo "*** $server ***" ; \
>         for i in {1..5}; \
>         do \
>             curl -s $server:30822 | grep address ; \
>         done ; \
>     done
*** kates-control ***
<p><span>Server&nbsp;address:</span> <span>10.244.2.20:80</span></p>
<p><span>Server&nbsp;address:</span> <span>10.244.1.20:80</span></p>
<p><span>Server&nbsp;address:</span> <span>10.244.1.20:80</span></p>
<p><span>Server&nbsp;address:</span> <span>10.244.0.10:80</span></p>
<p><span>Server&nbsp;address:</span> <span>10.244.1.20:80</span></p>
*** kates-node-01 ***
<p><span>Server&nbsp;address:</span> <span>10.244.1.20:80</span></p>
<p><span>Server&nbsp;address:</span> <span>10.244.1.20:80</span></p>
<p><span>Server&nbsp;address:</span> <span>10.244.0.10:80</span></p>
<p><span>Server&nbsp;address:</span> <span>10.244.1.20:80</span></p>
<p><span>Server&nbsp;address:</span> <span>10.244.1.20:80</span></p>
*** kates-node-02 ***
<p><span>Server&nbsp;address:</span> <span>10.244.2.20:80</span></p>
<p><span>Server&nbsp;address:</span> <span>10.244.2.20:80</span></p>
<p><span>Server&nbsp;address:</span> <span>10.244.0.10:80</span></p>
<p><span>Server&nbsp;address:</span> <span>10.244.1.20:80</span></p>
<p><span>Server&nbsp;address:</span> <span>10.244.1.20:80</span></p>
```
Perfect! It is working :smile:
You can always test it from multiple web browser tabs pointing to **http://\<k8s-node\>:30822/** and refreshing several times
___
{{< image src="nginx.png" caption="LoadBalancer testing of nginxdemos images" width="400" >}}

___
### References and influences
 - [Bootstrapping clusters with kubeadm](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/)
 - [Install Kubernetes Cluster on Ubuntu 20.04 with kubeadm](https://computingforgeeks.com/deploy-kubernetes-cluster-on-ubuntu-with-kubeadm/)
 - [How to set up Kubernetes Cluster on Ubuntu 20.04 with kubeadm and CRI-O](https://citizix.com/how-to-set-up-kubernetes-cluster-on-ubuntu-20-04-with-kubeadm-and-cri-o/)
 - [CRI-O on github](https://github.com/cri-o/cri-o)
 - [Running CRI-O with kubeadm](https://github.com/cri-o/cri-o/blob/main/tutorials/kubeadm.md)
 - [Tracing the path of network traffic in Kubernetes](https://learnk8s.io/kubernetes-network-packets)
 - [Flannel](https://mvallim.github.io/kubernetes-under-the-hood/documentation/kube-flannel.html)
 - [The Kubernetes Networking Guide > CNI > flannel](https://k8s.networkop.co.uk/cni/flannel/)
 - [Flannel Networking Demystify](https://msazure.club/flannel-networking-demystify/)
 - [How to Add Workers to Kubernetes Clusters](https://www.serverlab.ca/tutorials/containers/kubernetes/how-to-add-workers-to-kubernetes-clusters)
 - [Kubernetes Journey — Up and running out of the cloud — flannel](https://itnext.io/kubernetes-journey-up-and-running-out-of-the-cloud-flannel-c01283308f0e)
 - [Exposing an External IP Address to Access an Application in a Cluster](https://kubernetes.io/docs/tutorials/stateless-application/expose-external-ip-address/)
___



___
<!-- ## [Last Part - Installing and testing KNE](posts/kube-my-router-pt3/) -->

<!-- - [KNE on github](github.com/google/kne)
- [Inspired by this blog post covering KNE in a kind k8s](https://blog.itsalwaysthe.network/posts/kubernetes-based-network-emulation/)
-->

___



