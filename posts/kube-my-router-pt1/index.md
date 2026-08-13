# Kube My Router Up! - Part One

## Intro
___
While I was ramping up my skills in k8s, I bumped into google's Kubernetes based Network Emulation ([KNE](https://github.com/google/kne)), and since I've been a fool for network emulation software over the last twenty years, I knew I had to give it a go and see where it can get me.  I first heard of KNE during episode #015 of this [podcast](https://anchor.fm/netauto-hangout) and it seemed very promising to me since it is a way to spin up network topologies from devices running in containers orchestrated by a kubernetes cluster that, guess what, can span more than one host.

So, in these series of posts I will try to document my experiences setting it up and having fun with it :smile: since up to now there is too little documentation around it and also I think this [blog post](https://blog.itsalwaysthe.network/posts/kubernetes-based-network-emulation/) was the first to cover a basic orientation but still it covers running it inside a kind k8s node, i.e. in a container, where as my intent was to have the k8s spanning more than one machine since network devices are expensive in resources and my home lab is limited to 2x32GB EVE-NG servers.

- [Part One - Setting up the k8s VMs in EVE-NG](/posts/kube-my-router-pt1/)
- [Part Two - Deploying the k8s cluster with kubeadm](/posts/kube-my-router-pt2/)
- [Last Part - Installing and testing KNE](/posts/kube-my-router-pt3/)
---

## Part One - Setting up the VMs
---
### The Intent
  - EVE-NG for hosting linux VMs
  - Ubuntu 20.04 cloud image as base
  - 2xEVE-NG servers, 2.0.3-112 community edition - 3 VMs in total
  - Deployment of 3xLinux VMs for our k8s cluster
___

Well the first step towards testing KNE is to set up a k8s cluster.  I have two EVE-NG bare metal servers at home so I could spin up three VMs split in those two servers of 32GM RAM each.  I've chosen Ubuntu 20.04 linux flavor and decided to start by deploying the VMs using the cloud-image files. The approach followed here is to download the cloud image in both EVE-NG servers and create a seed file in order to pass the user password during first boot.  This will be used as the base ubuntu image for all VMs. Finally, once the base VM is ready, the topology can be created and all the VMs can be brought up and configured with the appropriate settings.

___
### Prepare Ubuntu base image in EVE-NG
___

Download Ubuntu 20.04 cloud image and place it into a temporary directory on the first server, optionally, verifying the md5sum.


```bash
root@eve-01# mkdir -p /opt/cloud && cd !$
mkdir -p /opt/cloud && cd /opt/cloud/

root@eve-01# wget https://cloud-images.ubuntu.com/focal/current/focal-server-cloudimg-amd64.img

< ...omitted... >

root@eve-01# ll
total 581388
drwxr-xr-x  2 root root      4096 May 29 21:19 ./
drwxr-xr-x 16 root root      4096 May 29 21:19 ../
-rw-r--r--  1 root root 595329024 May 24 01:51 focal-server-cloudimg-amd64.img

root@eve-01# curl -ks https://cloud-images.ubuntu.com/focal/current/MD5SUMS  | md5sum -c --ignore-missing
focal-server-cloudimg-amd64.img: OK
```
Copy the image to the appropriate **linux-** directory of EVE-NG in so that is categorised as a linux image. You can resize the image to your linking as well.

```bash
root@eve-01# mkdir -p /opt/unetlab/addons/qemu/linux-focal-server-cloudimg/

root@eve-01# cp focal-server-cloudimg-amd64.img !$hda.qcow2
cp focal-server-cloudimg-amd64.img /opt/unetlab/addons/qemu/linux-focal-server-cloudimg/hda.qcow2

root@eve-01# cd /opt/unetlab/addons/qemu/linux-focal-server-cloudimg/

root@eve-01# ll
total 581384
drwxr-xr-x  2 root root      4096 May 29 21:46 ./
drwxr-xr-x 12 root root      4096 May 29 21:45 ../
-rw-r--r--  1 root root 595329024 May 29 21:46 hda.qcow2

root@eve-01# qemu-img info hda.qcow2
image: hda.qcow2
file format: qcow2
virtual size: 2.2G (2361393152 bytes)
disk size: 568M
cluster_size: 65536
Format specific information:
    compat: 0.10
    refcount bits: 16

root@eve-01# qemu-img resize hda.qcow2 50G
Image resized.
root@eve-01# qemu-img info hda.qcow2
image: hda.qcow2
file format: qcow2
virtual size: 50G (53687091200 bytes)
disk size: 568M
cluster_size: 65536
Format specific information:
    compat: 0.10
    refcount bits: 16
```

___
### Install cloud-image utilities and prepare the seed file
___

Install the required package.
```bash
root@eve-01# cd /opt/cloud/

root@eve-01# apt install cloud-image-utils
< ...omitted...>
```
Prepare the seed file and copy it to the base image location.
```bash
root@eve-01# cat <<EOF > cloud-config
#cloud-config
system_info:
  default_user:
    name: "ubuntu"
    home: /home/ubuntu

password: "ubuntu123"
chpasswd: { expire: False }
hostname: "ubuntu"
ssh_pwauth: True
EOF

root@eve-01# cloud-localds seed cloud-config

root@eve-01# qemu-img info seed
image: seed
file format: raw
virtual size: 366K (374784 bytes)
disk size: 368K
root@eve-01# cp seed /opt/unetlab/addons/qemu/linux-focal-server-cloudimg/cdrom.iso
```
{{< admonition type=warning title="Heads Up" open=true >}}
Make sure you include the comment #cloud-config in the seed file
{{< /admonition >}}
___
### Build the VM topology in EVE-NG
___
Once both boot disk and seed cdrom files are in place, copy them onto the other node and run the **fixpermissions** script.

```Bash
root@eve-01# cd /opt/unetlab/addons/qemu/linux-focal-server-cloudimg/

root@eve-01# ll
total 581760
drwxr-xr-x  2 root root      4096 May 29 22:02 ./
drwxr-xr-x 12 root root      4096 May 29 21:45 ../
-rw-r--r--  1 root root    374784 May 29 22:02 cdrom.iso
-rw-r--r--  1 root root 595330048 May 29 21:47 hda.qcow2

root@eve-01# /opt/unetlab/wrappers/unl_wrapper -a fixpermissions

root@eve-01# ssh eve-02 "mkdir -p /opt/unetlab/addons/qemu/linux-focal-server-cloudimg"

root@eve-01# scp hda.qcow2 eve-02:/opt/unetlab/addons/qemu/linux-focal-server-cloudimg/

root@eve-01# scp cdrom.iso 192.168.1.22:/opt/unetlab/addons/qemu/linux-focal-server-cloudimg/

root@eve-01# ssh eve-02 "/opt/unetlab/wrappers/unl_wrapper -a fixpermissions"
```
Now everything is ready to start creating the topology via the GUI.  The following table lists the planning for my deployment:
|EVE-NG node | Role | VM name | IP address | CPU | RAM |
|:---:|:---:|:---:|:---:|:---:|:---:|
| eve-01 | control-node | kates-control | 192.168.1.30 | 4 | 4096 |
| eve-01 | worker | kates-node-01 | 192.168.1.31 | 8 | 28672 |
| eve-02 | worker | kates-node-02 | 192.168.1.32 | 8 | 28672 |

Here is how it looks like from GUI perspective:
<p>
{{< image src="eve-01.png" caption="EVE-01 Topology" src_s="eve-01.png" src_l="eve-01.png" width="500" >}}
{{< image src="eve-02.png" caption="EVE-02 Topology" src_s="eve-02.png" src_l="eve-02.png" width="500" >}}
</p>

You can also download the lab exports for [eve-01](eve-01.zip) and [eve-02](eve-02.zip)

{{< admonition type=danger title="Heads Up" open=true >}}
Due to the fact that EVE-NG allocates MAC addresses sequentially from a pool which is allocated per-POD and if you are using the same LAB POD on both servers, **kates-control** and **kates-node-02** (i.e. the first VMs on each node, since only EVE-01 has two nodes) will end up having the same MAC address. In order to avoid this, we can either use _dummy_ VMs, i.e. powered off VMs or we can specify the value for the first MAC address on the **kates-node-02** VM to cause EVE-NG to allocate a different MAC to the NIC, or simply we can use different EVE-NG PODs across the two servers to create the lab :smile:. I went for the latter and simpler method.
{{< image src="kates2.png" caption="Change MAC address of VM on second EVE server" src_s="kates2.png" src_l="kates2.png" width="400" >}}
Have this also in mind for all your other labs and topologies. The MAC allocation is per lab POD.
{{< /admonition >}}

___
### Start the labs and perform initial configuration
___



All VMs are ready to start.  Once all nodes are booted you can access them from the VNC or HTML5 console and perform the initial configuration, which includes:
- Disabling cloud-init
- Setting the hostname
- Configuring network addresses
- Updating and Upgrading

But, let's first check that all VMs are different and also the MAC addresses are not the same. The outputs shown are when using the same LAB POD in EVE-NG.

```bash {hl_lines=[8]}
# On kates-control
ubuntu@ubuntu:~$ sudo dmidecode -s system-uuid && cat /etc/machine-id && ip link
df8f1876-080b-4bb0-b000-f63819c781f3
df8f1876080b4bb0b000f63819c781f3
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
2: ens3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP mode DEFAULT group default qlen 1000
    link/ether 00:50:00:00:01:00 brd ff:ff:ff:ff:ff:ff
```


```bash {hl_lines=[8]}
# On kates-node-01
ubuntu@ubuntu:~$ sudo dmidecode -s system-uuid && cat /etc/machine-id && ip link
2b748bae-16c2-4abe-b65e-21a359658480
2b748bae16c24abeb65e21a359658480
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
2: ens3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP mode DEFAULT group default qlen 1000
    link/ether 00:50:00:00:02:00 brd ff:ff:ff:ff:ff:ff
```


```bash {hl_lines=[8]}
# On kates-node-02
ubuntu@ubuntu:~$ sudo dmidecode -s system-uuid && cat /etc/machine-id && ip link
9ba9c500-5d18-40e8-98e4-3e027f84e971
9ba9c5005d1840e898e43e027f84e971
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
2: ens3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP mode DEFAULT group default qlen 1000
    link/ether 00:60:00:00:01:00 brd ff:ff:ff:ff:ff:ff
```


Okay, now it is time to perform the initial configuration by disabling first the cloud-init service and then moving on. 

{{< admonition type=note title="Note that" open=true >}}
If the cloud-init service is not disabled, then we will not be able to change the hostname, so either we disable cloud init or modify the appropriate config file in order not to reset the hostname according to the seed file
{{< /admonition >}}

So from the VM console:

```bash 
ubuntu@ubuntu:~$ sudo touch /etc/cloud/cloud-init.disabled

ubuntu@ubuntu:~$ sudo hostnamectl set-hostname kates-control
```
Adjust the netplan file according to your environment and apply the configuration. I prefer to remove the static MAC assignment to the NIC

{{< highlight bash >}}
ubuntu@ubuntu:~$ sudo vi /etc/netplan/50-cloud-init.yaml

ubuntu@ubuntu:~$ cat /etc/netplan/50-cloud-init.yaml
network:
    ethernets:
        ens3:
            dhcp4: false
            dhcp6: false
            addresses: [192.168.1.30/24]
            gateway4: 192.168.1.1
            nameservers:
                    addresses: [192.168.1.1, 8.8.8.8]
    version: 2
ubuntu@ubuntu:~$ sudo netplan apply
{{< /highlight >}}

Now that the basic config has been done for all 3 nodes, we can reboot and login from a proper SSH terminal :smile: to verify network connectivity and by the next single command we perform any upgrade available and reboot the nodes if needed.



```bash 
ubuntu@kates-*:~$ sudo apt update \
                  && sudo apt -y full-upgrade \
                  && [ -f /var/run/reboot-required ] \
                  && sudo reboot -f
```
___
### References and influences
___
- [EVE-NG official site](https://www.eve-ng.net/)
- [Cloud config examples](https://cloudinit.readthedocs.io/en/latest/topics/examples.html)
- [Using Cloud Images in KVM](https://www.theurbanpenguin.com/using-cloud-images-in-kvm/)
___
## [Part Two - Deploying the k8s cluster with kubeadm](/posts/kube-my-router-pt2/)
___
## [Last Part - Installing and testing KNE](/posts/kube-my-router-pt3/)
___
## [Outro](/posts/kube-my-router-pt3/#outro)
___

---

> Author:    
> URL: https://net4fungr.github.io/posts/kube-my-router-pt1/  

