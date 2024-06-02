---
title: "Kube my router up! - Part Two"
subtitle: "Setup a 3 node k8s cluster with kubeadm"
date: 2022-05-31T12:40:24+03:00
draft: false
tags: [k8s, kubeadm, Ubuntu]
categories: [k8s]
collections: [Kube My Router Up!]
toc:
  enable: true
resources:
- name: "featured-image"
  src: "featured-image.png"
- name: "featured-image-preview"
  src: "featured-image-preview.png"
author: " "
summary: "This is the second part of a three-part blog post around google’s Kubernetes based Network Emulation (KNE) software. In this part, I am showing how to deploy a k8s cluster with a single control node using kubeadm over the VMs created during the first part."
code:
  copy: false
  maxShownLines: -1
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
  - Use containerd as the container runtime
  - Flannel as network overlay CNI plugin
___
The main question points while preparing the k8s cluster for KNE where which CRI and which CNI to use, since I am not very deep in to k8s. A brief research done on the kind container that KNE uses to deploy the cluster and run the simulations in it revealed that it uses containerd as the CRI.
```bash
❯ kubectl get nodes -owide
NAME                STATUS   ROLES                  AGE   VERSION   INTERNAL-IP   EXTERNAL-IP   OS-IMAGE                                   KERNEL-VERSION      CONTAINER-RUNTIME
kne-control-plane   Ready    control-plane,master   14d   v1.22.1   172.19.0.2    <none>        Ubuntu Impish Indri (development branch)   5.4.0-107-generic   containerd://1.5.5
```
Kindnet as the primary the CNI.
```bash
❯ kubectl get ds -n kube-system
NAME         DESIRED   CURRENT   READY   UP-TO-DATE   AVAILABLE   NODE SELECTOR            AGE
kindnet      1         1         1       1            1           <none>                   14d
kube-proxy   1         1         1       1            1           kubernetes.io/os=linux   14d
```
In terms of network configuration:
```bash
❯ docker ps
CONTAINER ID   IMAGE                  COMMAND                  CREATED       STATUS       PORTS                       NAMES
a099e5c3f7d3   kindest/node:v1.22.1   "/usr/local/bin/entr…"   2 weeks ago   Up 2 weeks   127.0.0.1:34459->6443/tcp   kne-control-plane

❯ docker exec -it a099e5c3f7d3 bash
root@kne-control-plane:/#

root@kne-control-plane:/# ll /etc/cni/net.d/
total 16
drwx------ 2 root root 4096 May 22 22:16 ./
drwx------ 3 root root 4096 May 22 22:14 ../
-r--r--r-- 1 root root  518 May 22 22:16 00-meshnet.conflist
-rw-r--r-- 1 root root  409 May 22 22:15 10-kindnet.conflist

root@kne-control-plane:/# cat /etc/cni/net.d/10-kindnet.conflist

{
        "cniVersion": "0.3.1",
        "name": "kindnet",
        "plugins": [
        {
                "type": "ptp",
                "ipMasq": false,
                "ipam": {
                        "type": "host-local",
                        "dataDir": "/run/cni-ipam-state",
                        "routes": [


                                { "dst": "0.0.0.0/0" }
                        ],
                        "ranges": [


                                [ { "subnet": "10.244.0.0/24" } ]
                        ]
                }
                ,
                "mtu": 1500

        },
        {
                "type": "portmap",
                "capabilities": {
                        "portMappings": true
                }
        }
        ]
}
root@kne-control-plane:/# cat /etc/cni/net.d/00-meshnet.conflist
{
        "cniVersion": "0.3.1",
        "name": "kindnet",
        "plugins": [
                {
                        "ipMasq": false,
                        "ipam": {
                                "dataDir": "/run/cni-ipam-state",
                                "ranges": [
                                        [
                                                {
                                                        "subnet": "10.244.0.0/24"
                                                }
                                        ]
                                ],
                                "routes": [
                                        {
                                                "dst": "0.0.0.0/0"
                                        }
                                ],
                                "type": "host-local"
                        },
                        "mtu": 1500,
                        "type": "ptp"
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
}root@kne-control-plane:/#
```
So it is a simple Layer 3 CNI, and meshnet will be installed on top of it. Let's use a more common CNI, like flannel for our use case.

{{< admonition type=note title="Using flannel" open=false >}}
When using flannel, the main drawback was the interface MTU inside the device container, seen on srlinux. Flannel, since it uses VXLAN, will inherit the MTU of the main ethernet interface of the host and create its bridge interface flannel.1 with an MTU of minus 50, i.e. 1450 by default. When spinning up the containers, they use this MTU and from what I saw, srlinux cannot bring up its interfaces that need a minimum of 1500 MTU. The only way of mitigating this easily is to use higher MTU on the host interface, so flannel can inherit this, which I presume in a _production_ environment should be something common and the network underlay would of course support jumbo's. More on this during final part.
{{< /admonition >}}

Let's change gears now and deploy the k8s cluster on the three VMs that are running on the two EVE-NG servers. Here's what we have up and running:
|EVE-NG node | Role | VM name | IP address | CPU | RAM |
|:---:|:---:|:---:|:---:|:---:|:---:|
| eve-01 | control-node | kates-control | 192.168.1.30 | 4 | 4096 |
| eve-01 | worker | kates-node-01 | 192.168.1.31 | 8 | 28672 |
| eve-02 | worker | kates-node-02 | 192.168.1.32 | 8 | 28672 |

We are going to deploy a single control node with two workers using kubeadm and also use the containerd container runtime.
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
$ sudo apt -y install vim git curl wget apt-transport-https ca-certificates

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
{{< admonition type=note title="Specific Version" open=false >}}
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
Remember that if you are using a specific version you will have to specify that while downloading the k8s images and/or during kubeadm init bootstrap of the control node.
{{< /admonition >}}

We now need to disable swap if we are using any (cloud images do not by default), since kubelet will not run unless swap is disabled.

```bash
$ sudo swapoff -a

# Comment out the relevant line in fstab to disable swap from loading on boot (usually last line)
$ sudo vi /etc/fstab
```
Enable kernel modules and bridge NF to iptables chains.
```bash
ubuntu@kates-control:~$ sudo modprobe overlay
ubuntu@kates-control:~$ sudo modprobe br_netfilter

ubuntu@kates-control:~$ cat <<EOF | sudo tee /etc/modules-load.d/k8s-cri.conf
> overlay
> br_netfilter
> EOF
overlay
br_netfilter

ubuntu@kates-control:~$ sudo tee /etc/sysctl.d/99-k8s-cri.conf<<EOF
> net.bridge.bridge-nf-call-ip6tables = 1
> net.bridge.bridge-nf-call-iptables = 1
> net.ipv4.ip_forward = 1
> EOF
net.bridge.bridge-nf-call-ip6tables = 1
net.bridge.bridge-nf-call-iptables = 1
net.ipv4.ip_forward = 1


# Reload sysctl to apply changes
ubuntu@kates-control:~$ sudo sysctl --system
```
___
### Install a container runtime
___
As far as CRI, there are three options available. Go with either **docker**, **containerd** or use **CRI-O**. For this post we are going with containerd, so the first step is to add the repo to our nodes and install the service.

```bash
ubuntu@kates-control:~$ curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo apt-key add -
OK

ubuntu@kates-control:~$ sudo add-apt-repository "deb [arch=amd64] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable"

ubuntu@kates-control:~$ sudo apt update -y

ubuntu@kates-control:~$ sudo apt install -y containerd.io
```
Next, put in place a default configuration.
```bash
ubuntu@kates-control:~$ sudo mv /etc/containerd/config.toml /etc/containerd/config.toml.orig

ubuntu@kates-control:~$ containerd config default | sudo tee /etc/containerd/config.toml
```
Next, set the cgroup to use systemd and re-start the service.

```bash
ubuntu@kates-control:~$ sudo sed -i s/"SystemdCgroup = false"/"SystemdCgroup = true"/g /etc/containerd/config.toml

ubuntu@kates-control:~$ sudo systemctl restart containerd
```
Test that pulling images works.
```bash
ubuntu@kates-control:~$ sudo ctr image pull docker.io/library/nginx:latest

ubuntu@kates-control:~$ sudo ctr image ls -q
docker.io/library/nginx:latest

# Delete the image
ubuntu@kates-control:~$ sudo ctr image rm docker.io/library/nginx:latest
docker.io/library/nginx:latest
```
{{< admonition type=note title="Access via proxy" open=false >}}
If you are behind a proxy, you can expose the proxy environment variables to the daemon.

```bash
$ sudo mkdir /etc/systemd/system/containerd.service.d/

$ sudo tee /etc/systemd/system/containerd.service.d/http-proxy.conf<<EOF
> [Service]
> Environment="HTTP_PROXY=http://<your_proxy>:<port>"
> Environment="HTTPS_PROXY=http://<your_proxy>:<port>"
> Environment="NO_PROXY=localhost,127.0.0.1,.domain.com"
> EOF

$ sudo systemctl daemon-reload
$ sudo systemctl restart containerd
```
**NOTE:** The __no_proxy__ variable will not accept subnet masks, only full /32 ip addresses.
{{< /admonition >}}

___
### Bootstrap k8s control node
___
We are ready now to initialise the control node on the first VM. First we need to enable the **kubelet** service if not already on.

```bash
ubuntu@kates-control:~$ systemctl is-enabled kubelet >/dev/null \
                && echo Service is already enabled \
                || echo Enabling kubelet \
                && sudo systemctl enable kubelet
Service is already enabled

```
No worries if the service does not load correctly, it will, after kubeadm finishes configuring the control node.
Download k8s images from the registry, optionally, specifying the k8s version.
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
ubuntu@kates-control:~$ sudo kubeadm config images pull --kubernetes-version stable-1.24 --cri-socket unix:///run/containerd/containerd.sock
[config/images] Pulled k8s.gcr.io/kube-apiserver:v1.24.1
[config/images] Pulled k8s.gcr.io/kube-controller-manager:v1.24.1
[config/images] Pulled k8s.gcr.io/kube-scheduler:v1.24.1
[config/images] Pulled k8s.gcr.io/kube-proxy:v1.24.1
[config/images] Pulled k8s.gcr.io/pause:3.7
[config/images] Pulled k8s.gcr.io/etcd:3.5.3-0
[config/images] Pulled k8s.gcr.io/coredns/coredns:v1.8.6

ubuntu@kates-control:~$ sudo ctr -n k8s.io image ls -q | grep -v sha
k8s.gcr.io/coredns/coredns:v1.8.6
k8s.gcr.io/etcd:3.5.3-0
k8s.gcr.io/kube-apiserver:v1.24.1
k8s.gcr.io/kube-controller-manager:v1.24.1
k8s.gcr.io/kube-proxy:v1.24.1
k8s.gcr.io/kube-scheduler:v1.24.1
k8s.gcr.io/pause:3.7
```
{{< admonition type=note title="Using crictl instead" open=false >}}
If you prefer to use crictl, you can create a configuration file for containerd to avoid the warnings
```bash
ubuntu@kates-control:~$ sudo tee cat /etc/crictl.yaml <<EOF
> runtime-endpoint: unix:///var/run/containerd/containerd.sock
> image-endpoint: unix:///run/containerd/containerd.sock
> timeout: 10
> debug: false
> EOF
runtime-endpoint: unix:///var/run/containerd/containerd.sock
image-endpoint: unix:///run/containerd/containerd.sock
timeout: 10
debug: false

ubuntu@kates-control:~$ sudo crictl images
IMAGE                                TAG                 IMAGE ID            SIZE
k8s.gcr.io/coredns/coredns           v1.8.6              a4ca41631cc7a       13.6MB
k8s.gcr.io/etcd                      3.5.3-0             aebe758cef4cd       102MB
k8s.gcr.io/kube-apiserver            v1.24.1             e9f4b425f9192       33.8MB
k8s.gcr.io/kube-controller-manager   v1.24.1             b4ea7e648530d       31MB
k8s.gcr.io/kube-proxy                v1.24.1             beb86f5d8e6cd       39.5MB
k8s.gcr.io/kube-scheduler            v1.24.1             18688a72645c5       15.5MB
k8s.gcr.io/pause                     3.7                 221177c6082a8       311kB

```
{{< /admonition >}}

Now we can use kubeadm to bootstrap the node setting the POD network and, again, by optionally specifying the version. The init process will get the appropriate images if they do not exist locally already.



```bash
ubuntu@kates-control:~$ sudo kubeadm init --pod-network-cidr=10.244.0.0/16 --cri-socket /run/containerd/containerd.sock --kubernetes-version stable-1.24
W0606 09:39:22.344649   33934 initconfiguration.go:120] Usage of CRI endpoints without URL scheme is deprecated and can cause kubelet errors in the future. Automatically prepending scheme "unix" to the "criSocket" with value "/run/containerd/containerd.sock". Please update your configuration!
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
[apiclient] All control plane components are healthy after 9.004673 seconds
[upload-config] Storing the configuration used in ConfigMap "kubeadm-config" in the "kube-system" Namespace
[kubelet] Creating a ConfigMap "kubelet-config" in namespace kube-system with the configuration for the kubelets in the cluster
[upload-certs] Skipping phase. Please see --upload-certs
[mark-control-plane] Marking the node kates-control as control-plane by adding the labels: [node-role.kubernetes.io/control-plane node.kubernetes.io/exclude-from-external-load-balancers]
[mark-control-plane] Marking the node kates-control as control-plane by adding the taints [node-role.kubernetes.io/master:NoSchedule node-role.kubernetes.io/control-plane:NoSchedule]
[bootstrap-token] Using token: kggzqq.5vz1esxhxfw1wgxf
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

kubeadm join 192.168.1.30:6443 --token kggzqq.5vz1esxhxfw1wgxf \
        --discovery-token-ca-cert-hash sha256:d83d4dd95515623997f68d12a5bb19adda871ba8d81dc389ac787746d49ea9e2


```
{{< admonition type=tip title="Join Token" open=true >}}
The join token created by kubeadm will last I think for 24hrs, so if you are joining workers sooner you could copy the join command in a text pad or something for later use.
{{< /admonition >}}
Now as instructed by the init process, copy the admin.conf into your users directory in order to be able to use kubectl to operate your cluster.

```bash
ubuntu@kates-control:~$ mkdir -p $HOME/.kube
ubuntu@kates-control:~$ sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
ubuntu@kates-control:~$ sudo chown $(id -u):$(id -g) $HOME/.kube/config
```
And run some kubectl to check your control-plane.
```bash
ubuntu@kates-control:~$ kubectl cluster-info
Kubernetes control plane is running at https://192.168.1.30:6443
CoreDNS is running at https://192.168.1.30:6443/api/v1/namespaces/kube-system/services/kube-dns:dns/proxy

To further debug and diagnose cluster problems, use 'kubectl cluster-info dump'.

ubuntu@kates-control:~$ kubectl get nodes -owide
NAME            STATUS     ROLES           AGE    VERSION   INTERNAL-IP    EXTERNAL-IP   OS-IMAGE             KERNEL-VERSION      CONTAINER-RUNTIME
kates-control   NotReady   control-plane   104s   v1.24.1   192.168.1.30   <none>        Ubuntu 20.04.4 LTS   5.4.0-117-generic   containerd://1.6.6

ubuntu@kates-control:~$ kubectl get all -A
NAMESPACE     NAME                                        READY   STATUS    RESTARTS   AGE
kube-system   pod/coredns-6d4b75cb6d-r5k7h                0/1     Pending   0          2m8s
kube-system   pod/coredns-6d4b75cb6d-xwfnq                0/1     Pending   0          2m8s
kube-system   pod/etcd-kates-control                      1/1     Running   0          2m23s
kube-system   pod/kube-apiserver-kates-control            1/1     Running   0          2m23s
kube-system   pod/kube-controller-manager-kates-control   1/1     Running   0          2m25s
kube-system   pod/kube-proxy-gnq29                        1/1     Running   0          2m8s
kube-system   pod/kube-scheduler-kates-control            1/1     Running   0          2m23s

NAMESPACE     NAME                 TYPE        CLUSTER-IP   EXTERNAL-IP   PORT(S)                  AGE
default       service/kubernetes   ClusterIP   10.96.0.1    <none>        443/TCP                  2m25s
kube-system   service/kube-dns     ClusterIP   10.96.0.10   <none>        53/UDP,53/TCP,9153/TCP   2m23s

NAMESPACE     NAME                        DESIRED   CURRENT   READY   UP-TO-DATE   AVAILABLE   NODE SELECTOR            AGE
kube-system   daemonset.apps/kube-proxy   1         1         1       1            1           kubernetes.io/os=linux   2m23s

NAMESPACE     NAME                      READY   UP-TO-DATE   AVAILABLE   AGE
kube-system   deployment.apps/coredns   0/2     2            0           2m23s

NAMESPACE     NAME                                 DESIRED   CURRENT   READY   AGE
kube-system   replicaset.apps/coredns-6d4b75cb6d   2         2         0       2m9s

# componentstatus seems old :smile:
ubuntu@kates-control:~$  kubectl get cs -A
Warning: v1 ComponentStatus is deprecated in v1.19+
NAME                 STATUS    MESSAGE                         ERROR
scheduler            Healthy   ok
controller-manager   Healthy   ok
etcd-0               Healthy   {"health":"true","reason":""}
```
___
### Install network CNI
___
Now, still on the control node, we are going to deploy the Flannel CNI plugin. 
```bash 
ubuntu@kates-control:~$ kubectl apply -f https://raw.githubusercontent.com/coreos/flannel/master/Documentation/kube-flannel.yml
Warning: policy/v1beta1 PodSecurityPolicy is deprecated in v1.21+, unavailable in v1.25+
podsecuritypolicy.policy/psp.flannel.unprivileged created
clusterrole.rbac.authorization.k8s.io/flannel created
clusterrolebinding.rbac.authorization.k8s.io/flannel created
serviceaccount/flannel created
configmap/kube-flannel-cfg created
daemonset.apps/kube-flannel-ds created
```
Check how it looks on control-plane.
```bash
ubuntu@kates-control:~$ kubectl get all -A
NAMESPACE     NAME                                        READY   STATUS    RESTARTS   AGE
kube-system   pod/coredns-6d4b75cb6d-fvskj                1/1     Running   0          8m12s
kube-system   pod/coredns-6d4b75cb6d-xrflm                1/1     Running   0          8m12s
kube-system   pod/etcd-kates-control                      1/1     Running   0          8m25s
kube-system   pod/kube-apiserver-kates-control            1/1     Running   0          8m27s
kube-system   pod/kube-controller-manager-kates-control   1/1     Running   0          8m25s
kube-system   pod/kube-flannel-ds-55st2                   1/1     Running   0          65s
kube-system   pod/kube-proxy-8wjpp                        1/1     Running   0          8m13s
kube-system   pod/kube-scheduler-kates-control            1/1     Running   0          8m25s

NAMESPACE     NAME                 TYPE        CLUSTER-IP   EXTERNAL-IP   PORT(S)                  AGE
default       service/kubernetes   ClusterIP   10.96.0.1    <none>        443/TCP                  8m27s
kube-system   service/kube-dns     ClusterIP   10.96.0.10   <none>        53/UDP,53/TCP,9153/TCP   8m25s

NAMESPACE     NAME                             DESIRED   CURRENT   READY   UP-TO-DATE   AVAILABLE   NODE SELECTOR            AGE
kube-system   daemonset.apps/kube-flannel-ds   1         1         1       1            1           <none>                   65s
kube-system   daemonset.apps/kube-proxy        1         1         1       1            1           kubernetes.io/os=linux   8m25s

NAMESPACE     NAME                      READY   UP-TO-DATE   AVAILABLE   AGE
kube-system   deployment.apps/coredns   2/2     2            2           8m25s

NAMESPACE     NAME                                 DESIRED   CURRENT   READY   AGE
kube-system   replicaset.apps/coredns-6d4b75cb6d   2         2         2       8m13s
```
And from the network side.
```bash
ubuntu@kates-control:~$ ip ro ; ip add
default via 192.168.1.1 dev ens3 proto static
10.244.0.0/24 dev cni0 proto kernel scope link src 10.244.0.1
192.168.1.0/24 dev ens3 proto kernel scope link src 192.168.1.30
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
    inet 127.0.0.1/8 scope host lo
       valid_lft forever preferred_lft forever
    inet6 ::1/128 scope host
       valid_lft forever preferred_lft forever
2: ens3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000
    link/ether 00:50:02:00:01:00 brd ff:ff:ff:ff:ff:ff
    inet 192.168.1.30/24 brd 192.168.1.255 scope global ens3
       valid_lft forever preferred_lft forever
    inet6 2a02:587:e44a:d37:250:2ff:fe00:100/64 scope global dynamic mngtmpaddr noprefixroute
       valid_lft 604763sec preferred_lft 86363sec
    inet6 fe80::250:2ff:fe00:100/64 scope link
       valid_lft forever preferred_lft forever
3: flannel.1: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1450 qdisc noqueue state UNKNOWN group default
    link/ether f2:64:03:ac:1f:68 brd ff:ff:ff:ff:ff:ff
    inet 10.244.0.0/32 scope global flannel.1
       valid_lft forever preferred_lft forever
    inet6 fe80::f064:3ff:feac:1f68/64 scope link
       valid_lft forever preferred_lft forever
4: cni0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1450 qdisc noqueue state UP group default qlen 1000
    link/ether e2:92:cd:73:85:3d brd ff:ff:ff:ff:ff:ff
    inet 10.244.0.1/24 brd 10.244.0.255 scope global cni0
       valid_lft forever preferred_lft forever
    inet6 fe80::e092:cdff:fe73:853d/64 scope link
       valid_lft forever preferred_lft forever
5: vethdc5600c6@if3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1450 qdisc noqueue master cni0 state UP group default
    link/ether f2:8f:bd:a7:dc:82 brd ff:ff:ff:ff:ff:ff link-netns cni-0155810e-5cb5-58a5-22c4-dc8038081174
    inet6 fe80::f08f:bdff:fea7:dc82/64 scope link
       valid_lft forever preferred_lft forever
6: vethe9a1a648@if3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1450 qdisc noqueue master cni0 state UP group default
    link/ether aa:09:c5:8c:bb:66 brd ff:ff:ff:ff:ff:ff link-netns cni-d71bf00b-ba62-2a8d-548a-9430a25d8dcd
    inet6 fe80::a809:c5ff:fe8c:bb66/64 scope link
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
NAME            STATUS   ROLES           AGE   VERSION   INTERNAL-IP    EXTERNAL-IP   OS-IMAGE             KERNEL-VERSION      CONTAINER-RUNTIME
kates-control   Ready    control-plane   11m   v1.24.1   192.168.1.30   <none>        Ubuntu 20.04.4 LTS   5.4.0-117-generic   containerd://1.6.6
kates-node-01   Ready    <none>          66s   v1.24.1   192.168.1.31   <none>        Ubuntu 20.04.4 LTS   5.4.0-117-generic   containerd://1.6.6
kates-node-02   Ready    <none>          59s   v1.24.1   192.168.1.32   <none>        Ubuntu 20.04.4 LTS   5.4.0-117-generic   containerd://1.6.6
```
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

# Untaint the control plane to run pods if you wish
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
NAME                       READY   STATUS    RESTARTS   AGE   IP           NODE            NOMINATED NODE   READINESS GATES
pod/web-54b75887bb-2glrx   1/1     Running   0          11s   10.244.2.3   kates-node-02   <none>           <none>
pod/web-54b75887bb-7jrf4   1/1     Running   0          11s   10.244.1.2   kates-node-01   <none>           <none>
pod/web-54b75887bb-j76kz   1/1     Running   0          11s   10.244.2.2   kates-node-02   <none>           <none>

NAME                 TYPE        CLUSTER-IP   EXTERNAL-IP   PORT(S)   AGE   SELECTOR
service/kubernetes   ClusterIP   10.96.0.1    <none>        443/TCP   12m   <none>

NAME                  READY   UP-TO-DATE   AVAILABLE   AGE   CONTAINERS   IMAGES             SELECTOR
deployment.apps/web   3/3     3            3           11s   hello        nginxdemos/hello   app=web

NAME                             DESIRED   CURRENT   READY   AGE   CONTAINERS   IMAGES             SELECTOR
replicaset.apps/web-54b75887bb   3         3         3       11s   hello        nginxdemos/hello   app=web,pod-template-hash=54b75887bb

# Create a LoadBalancer service
ubuntu@kates-control:~$ kubectl expose deployment web --type=LoadBalancer --name=web-service
service/web-service exposed

ubuntu@kates-control:~$ kubectl get svc -o wide
NAME          TYPE           CLUSTER-IP       EXTERNAL-IP   PORT(S)        AGE   SELECTOR
kubernetes    ClusterIP      10.96.0.1        <none>        443/TCP        13m   <none>
web-service   LoadBalancer   10.101.141.116   <pending>     80:30721/TCP   10s   app=web

# Test communication to each pod
ubuntu@kates-control:~$ curl -s 10.244.2.3 | grep Server
<p><span>Server&nbsp;address:</span> <span>10.244.2.3:80</span></p>
<p><span>Server&nbsp;name:</span> <span>web-54b75887bb-2glrx</span></p>

ubuntu@kates-control:~$ curl -s 10.244.1.2 | grep Server
<p><span>Server&nbsp;address:</span> <span>10.244.1.2:80</span></p>
<p><span>Server&nbsp;name:</span> <span>web-54b75887bb-7jrf4</span></p>

ubuntu@kates-control:~$ curl -s 10.244.2.2 | grep Server
<p><span>Server&nbsp;address:</span> <span>10.244.2.2:80</span></p>
<p><span>Server&nbsp;name:</span> <span>web-54b75887bb-j76kz</span></p>

# Now test on the exposed port on the k8s hosts 
ubuntu@kates-control:~$ for server in kates-control kates-node-01 kates-node-02 ; \
>     do  \
>         echo "*** $server ***" ; \
>         for i in {1..5}; \
>         do \
>             curl -s $server:30721 | grep address ; \
>         done ; \
>     done
*** kates-control ***
<p><span>Server&nbsp;address:</span> <span>10.244.2.3:80</span></p>
<p><span>Server&nbsp;address:</span> <span>10.244.2.3:80</span></p>
<p><span>Server&nbsp;address:</span> <span>10.244.2.2:80</span></p>
<p><span>Server&nbsp;address:</span> <span>10.244.2.2:80</span></p>
<p><span>Server&nbsp;address:</span> <span>10.244.2.3:80</span></p>
*** kates-node-01 ***
<p><span>Server&nbsp;address:</span> <span>10.244.2.3:80</span></p>
<p><span>Server&nbsp;address:</span> <span>10.244.2.3:80</span></p>
<p><span>Server&nbsp;address:</span> <span>10.244.1.2:80</span></p>
<p><span>Server&nbsp;address:</span> <span>10.244.1.2:80</span></p>
<p><span>Server&nbsp;address:</span> <span>10.244.2.2:80</span></p>
*** kates-node-02 ***
<p><span>Server&nbsp;address:</span> <span>10.244.1.2:80</span></p>
<p><span>Server&nbsp;address:</span> <span>10.244.2.3:80</span></p>
<p><span>Server&nbsp;address:</span> <span>10.244.1.2:80</span></p>
<p><span>Server&nbsp;address:</span> <span>10.244.2.2:80</span></p>
<p><span>Server&nbsp;address:</span> <span>10.244.2.2:80</span></p>
```
Perfect! It is working :smile:
You can always test it from multiple web browser tabs pointing to **http://\<k8s-node\>:30721/** and refreshing several times
___
{{< image src="nginx.png" caption="LoadBalancer testing of nginxdemos images" width="400" >}}

___
### References and influences
 - [Bootstrapping clusters with kubeadm](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/)
 - [Install Kubernetes Cluster on Ubuntu 20.04 with kubeadm](https://computingforgeeks.com/deploy-kubernetes-cluster-on-ubuntu-with-kubeadm/)
 - [Kubernetes 1.23 + containerd](https://kubesimplify.com/kubernetes-containerd-setup)
 - [Tracing the path of network traffic in Kubernetes](https://learnk8s.io/kubernetes-network-packets)
 - [Exposing an External IP Address to Access an Application in a Cluster](https://kubernetes.io/docs/tutorials/stateless-application/expose-external-ip-address/)
___
## [Last Part - Installing and testing KNE](/posts/kube-my-router-pt3/)
___
## [Outro](/posts/kube-my-router-pt3/#outro)
___


