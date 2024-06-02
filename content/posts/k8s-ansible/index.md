---
title: "k8s Ansible"
subtitle: "Yet Another Ansible Playbook for k8s Cluster Deployment"
date: 2022-07-06T15:36:24+03:00
draft: false
tags: [k8s,ansible,automation]
categories: [ansible]
toc:
  enable: true
code:
  copy: true
  maxShownLines: -1
featuredImage: "featured-image.png"
featuredImagePreview: "featured-image.png"
author: " "
summary: "Yet another post about using ansible to provision a kubernetes single control node cluster with kubeadm. We start off by manually provisioning the linux VMs in EVE-NG with a pre-defined username/passwd and dynamic IP addresses. Ansible takes care all the automation tasks to deploy the cluster on the VMs."
---
## Intro
___
Throughout this post, I am documenting my ansible orientation and ramping-up process towards automating the provisioning of a k8s cluster on ubuntu linux. I believe it is not something too fancy or something that has not been visited over and over again in various other posts, but this is the scrub of my exposure with ansible automation. I tried to make it modular with several playbook imports and task includes executed from a _parent_ playbook file, rather than having a single long playbook. Ansible _roles_ are not leveraged :grin:. The _code_ for this project can be found [here](https://github.com/becos76/k8s_ansible/).
___
## The Intent
___
Let's begin by setting the in-scope items for the project:
- Ubuntu 20.04 VMs based on cloud images provisioned with a known username/passwd and assigned DHCP IPv4 addresses. (Setting up the VMs [reference](/posts/kube-my-router-pt1))
- Kubernetes single node cluster version 1.22
- Docker CRI
- Flannel CNI
- Single playbook which calls subsequent playbooks and task lists at runtime
- Kubeadm for cluster setup
___
## Playbook Overview
___
The following mindmap diagram represents the automation tasks flows. <span style="color:red">Red </span>lines represent imported playbook files. <span style="color:green">Green </span>lines are included task lists files, and <span style="color:#7a28FF">blue </span> lines are the actual tasks to be executed.

{{< image src="play_mmap.png" caption="k8s Ansible Playbook Flow" width="800" >}}

In short, we start from a single playbook file called _start.yml_ and we have broken down our flow in three phases.  The _**init**_ phase covers Steps 01 and 02, and refer to assigning static IPs to our dynamic VMs. Step 01 is about building the mapping from DHCP to Static IPs of our nodes and generating the relevant _netplan_ configuration files using a jinja2 template. Step 02 covers the application of these configuration files to the VMs.

Next, is the _**pre-deployment**_ phase, or Step 03, which is about preparing the VMs for k8s deployment, i.e. setting hostnames, establishing SSH key authentication with ansible, upgrading, etc.

The final phase is the _**deployment**_ one, where we call our tasks to deploy the k8s cluster upon the relevant control and worker nodes.

The _**check**_ phase, although not depicted in the flow, is a very important one during which we do our environment pre-checks in order for the playbook to be executed successfully, i.e. are all hosts declared properly in the ansible hosts file, are all variables declared as they should be,etc.

Let's expand on the directory structure in order to make things more explicit.
___
### Directory Layout
___
Here is how the tree of our ansible playbook _home_ directory looks like:


```bash {hl_lines="13-14 2 7 22 24 32 34"}
.
├── .secrets -------------------< Custom directory to hold sensitive data
│   ├── passwd.yml -------------< Encrypted secrets file
│   └── vault_passwd -----------< Ansible-vault clear text password
├── ansible.cfg ----------------< ansible configuration file
├── checks.yml -----------------< "Pre-checks" playbook - Step 00
├── configs --------------------< Directory to store generated static ip netplan files
├── deployment.yml -------------< "Deploy" phase playbook - Step 04
├── hosts ----------------------< ansible inventory file in ini format
├── init_play.yml --------------< "Init" phase playbook - Step 01
├── pre_deploy.yml -------------< "Pre-deploy" phase playbook - Step 03
├── start.yml --------------->>>> "Master" playbook
├── tasks ----------------------< Folder to hold all task lists files arranged per phase
│   ├── deploy
│   │   ├── boot_control.yml
│   │   ├── cni.yml
│   │   ├── cri.yml
│   │   ├── packages_general.yml
│   │   ├── packages_kube.yml
│   │   ├── swap.yml
│   │   └── workers.yml
│   ├── init
│   │   └── apply_netplan.yml --< Step 02 playbook
│   └── pre
│       ├── cloud-init.yml
│       ├── hostname.yml
│       ├── hosts.yml
│       ├── reboot.yml
│       ├── sshkeys.yml
│       ├── sudo.yml
│       └── upgrade.yml
├── templates ------------------< Templates default folder
│   └── netplan.j2
└── vars -----------------------< Custom directory to host variables
    └── netplan.yml
```
Below is the ansible configuration file where we define which file contains the inventory. We instruct ansible not complain if the SSH target hosts are not known. For facts gathering, we only need the network facts and not the hardware ones. We define where is the encryption password for ansible-vault. The _callback_whitelist_ is very useful if we want to see timing statistics of our playbook execution.

```dosini 
[defaults]
inventory = hosts
host_key_checking = False
gather_subset=!hardware, network
vault_password_file=.secrets/vault_passwd
#callback_whitelist = timer, profile_tasks
```
<p style="background-color:deepskyblue;text-align:center"><b>ansible.cfg</b></p>

### Ansible key files overview
Here is our inventory file:
```dosini
[all:vars]
ansible_ssh_common_args='-o UserKnownHostsFile=/dev/null'
ansible_user=ubuntu
ansible_ssh_private_key_file=~/.ssh/id_ansible
k8s_version=1.22.10
k8s_pod_cidr=10.244.0.0/16

[control]
kates-control ansible_host=192.168.1.40

[workers]
kates-node-01 ansible_host=192.168.1.41
kates-node-02 ansible_host=192.168.1.42
kates-node-03 ansible_host=192.168.1.43

[dhcp_hosts]
192.168.1.203
192.168.1.206
192.168.1.208
192.168.1.209
```
<p style="background-color:deepskyblue;text-align:center"><b>hosts</b></p>

We split our targets into three groups and declare common variables in the _all_ section. The _ansible_ssh_common_args_ variable prevents ansible to complain about host key changes, since these VMs were re-provisioned a lot of times during testing the playbook and were getting the same DHCP addresses. We declare here the SSH user that is used for the initial connection to the _dynamic_ hosts till the point that these hosts are assigned static IPs and configured with an SSH public key in order for ansible to continue further with the tasks.

The _passwd.yml_ file contains the passwords that ansible will use for SSH and _sudo_ access on the targets. These are used initially and then _publickey_ and sudoless access is enabled.

```bash
$ ansible-vault view .secrets/passwd.yml
ansible_sudo_pass: "ubuntu123"
ansible_become_pass: "ubuntu123"
ansible_ssh_pass: "ubuntu123"
```
<p style="background-color:deepskyblue;text-align:center"><b>.secrets/passwd.yml</b></p>

Let's now check the variables file that will be loaded during play runtime.
```yaml
---
netplan:
        gateway4: 192.168.1.1
        subnet: 24
        dns:
                - 192.168.1.1
                - 8.8.8.8

```
<p style="background-color:deepskyblue;text-align:center"><b>vars/netplan.yml</b></p>

It is a dictionary containing all variables needed to populate the _jinja2_ template and produce the respective netplan configuration file that will enable assigning static ip to our hosts.

Here is the _jinja2_ template file:
```jinja
network:
    ethernets:
        {{ item.intf }}:
          dhcp4: false
          dhcp6: false
          addresses: [{{ item.newIP }}/{{ netplan.subnet }}]
          gateway4: {{ netplan.gateway4 }}
          nameservers:
             addresses: [{% for dns in netplan.dns %}{{dns}}{%- if not loop.last %}, {% endif %}{% endfor %}]
    version: 2
```
<p style="background-color:deepskyblue;text-align:center"><b>templates/netplan.j2</b></p>

So, this template will iterate over a list of dictionaries that will be created in runtime containing a mapping of _dynamic_ IP to _static_ one along with the _netplan_ variables for each hosts. The outcome will be a netplan config file that will be placed and applied on the target host.
{{< admonition note >}}
For DNS entries, since we can have more than one, we append a _comma_ if it is not the last item in order to build the list.
{{< /admonition >}}

Last but not least, here is the _master_ playbook, or `playbook zero` that I like to call it.
```yaml
#!/usr/bin/env ansible-playbook
---
- name: ONE PLAY TO CONTROL ALL
  hosts: all
  gather_facts: no

- name: "<! ################# CHECK :: PRE-FLIGHT CHECKING ################### !>"
  import_playbook: checks.yml

- name: "<! ################# INIT :: PREPARE FOR STATIC IPs ################# !>"
  import_playbook: init_play.yml

- name: "<! ################# INIT :: CHANGE TO STATIC IPs ################### !>"
  import_playbook: tasks/init/apply_netplan.yml

- name: "<! ################# PRE :: PERFORM PRE-DEPLOYMENT TASKS ############ !>"
  import_playbook: pre_deploy.yml

- name: "<! ################# DEPLOY :: PERFORM DEPLOYMENT TASKS ############# !>"
  import_playbook: deployment.yml

```
<p style="background-color:deepskyblue;text-align:center"><b>start.yml</b></p>

Pretty straight forward. It is just importing all other playbooks one by one :smile:
___
### Ansible modules in play
___
The following table lists all ansible modules used in this project in alphabetical order along with a short description on their use.

|Short Name| FQCN | Description|
|---|---|---|
| apt | [ansible.builtin.apt](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/apt_module.html) | Manages _apt_ packages in Debian/Ubuntu distros |
| apt_key | [ansible.builtin.apt_key](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/apt_key_module.html) | Manages keys in _apt_ keyring  |
| apt_repository | [ansible.builtin.apt_repository](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/apt_repository_module.html) | Manages _apt_ repositories  |
| assert | [ansible.builtin.assert](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/assert_module.html) | Evaluates if given expressions are true  |
| authorized_key | [ansible.posix.authorized_key](https://docs.ansible.com/ansible/latest/collections/ansible/posix/authorized_key_module.html) | Manages SSH authorized keys of user accounts |
| blockinfile | [ansible.builtin.blockinfile](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/blockinfile_module.html) | Manages a block of multi-line text surrounded by customizable marker lines in files |
| command | [ansible.builtin.command](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/command_module.html) | Executes commands on linux targets without invoking a shell  |
| copy | [ansible.builtin.copy](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/copy_module.html) | Copy files to remote linux locations  |
| debug | [ansible.builtin.debug](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/debug_module.html) | Print statements during execution and can be useful for debugging variables or expressions without necessarily halting the playbook |
| file | [ansible.builtin.file](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/file_module.html) | Manage files, attributes of files, symlinks or directories in linux nodes |
| hostname | [ansible.builtin.hostname](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/hostname_module.html) | Set the hostname in most linux distros |
| import_playbook | [ansible.builtin.import_playbook](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/import_playbook_module.html) | Imports a playbook file in the current playbook for execution |
| include_tasks | [ansible.builtin.include_tasks](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/include_tasks_module.html) | Dynamically includes a file with a list of tasks to be executed in the current playbook |
| include_vars | [ansible.builtin.include_vars](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/include_vars_module.html) | Loads YAML/JSON variables dynamically from a file or directory, recursively, during task runtime |
| lineinfile | [ansible.builtin.lineinfile](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/lineinfile_module.html) | Manage lines in a text file |
| meta | [ansible.builtin.meta](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/meta_module.html) | Execute ansible _actions_  |
| openssh_keypair | [community.crypto.openssh_keypair](https://docs.ansible.com/ansible/latest/collections/community/crypto/openssh_keypair_module.html) | (Re)Generate OpenSSH private and public keys |
| reboot | [ansible.builtin.reboot](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/reboot_module.html) | Reboot a machine, wait for it to go down, come back up, and respond to commands |
| replace | [ansible.builtin.replace](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/replace_module.html) | Replace all instances of a particular string in a file using a back-referenced regular expression |
| set_fact | [ansible.builtin.set_fact](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/set_fact_module.html) | Set host variable(s) and fact(s) |
| setup | [ansible.builtin.setup](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/setup_module.html) | Gathers facts about remote hosts |
| shell | [ansible.builtin.shell](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/shell_module.html) | Execute shell commands on targets |
| stat | [ansible.builtin.stat](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/stat_module.html) | Retrieve file or file system status |
| systemd | [ansible.builtin.systemd](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/systemd_module.html) | Manage systemd units |
| template | [ansible.builtin.template](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/template_module.html) | Template a file out to a target host using _jinja2_ |
| user | [ansible.builtin.user](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/user_module.html) | Manage user accounts and user attributes |
| wait_for | [ansible.builtin.wait_for](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/wait_for_module.html) | Waits for a condition before continuing |
___
## Phased Execution
___
Let's delve a bit deeper on the phases now. We will just analyse some key tasks to make the logic more explicit.
___
### The _check_ phase
___

As previously states, during this phase we are aiming to check if all variables, files, and configurations are how they are supposed to be, or better how are playbooks want them to be in order to execute correctly.  The most popular modules used here are those of _debug_ and _assert_.

Let's see for example a simple check on the inventory groups:
```yaml
- name: INVENTORY CHECK - SINGLE CONTROL NODE
  debug: 
    msg: "control group is not correctly populated for a single (1) control node"
  when: (not groups.control) or (groups.control|length > 1)
  failed_when: (not groups.control) or (groups.control|length > 1)
```
What we do here is making sure the group _control_ is defined and it contains only one target host definition, since we are deploying a single control node cluster. This task will be executed only `when` the condition we are checking is _false_ and will be declared as failed using the `failed_when` clause.

Another simple example is using _assert_:
```yaml
- name: CHECK QUANTITIES
  assert:
    that: groups.dhcp_hosts|length == (groups.control+groups.workers)|length
    quiet: yes
    fail_msg: "Number of DHCP hosts cannot be different of number of K8s nodes"

```
Here, we are checking that we have the same number of _dynamic_ hosts defined as the total number of k8s nodes, workers and control nodes together, since there will be a one-to-one mapping in the configuration and deployment.

Now, let's see how we check the variables file:
```yaml
- name: CHECK FOR NETPLAN VARIABLES FILE
  stat:
    path: "{{ lookup('ansible.builtin.env', 'PWD') }}/vars/netplan.yml"
  register: netplan_file

- debug: msg="Netplan variables file is not found"
  when: not netplan_file.stat.exists
  failed_when: not netplan_file.stat.exists

- name: INCLUDING NETPLAN VARIABLES
  include_vars:
    dir: "{{ lookup('ansible.builtin.env', 'PWD') }}/vars"
    files_matching: netplan.yml

- name: CHECKING NETPLAN VARIABLES
  assert:
    that: 
      - netplan is defined and netplan
      - netplan.gateway4 is defined and netplan.gateway4
      - netplan.subnet is defined and netplan.subnet|int > 0 and netplan.subnet <= 31
      - netplan.dns is defined and netplan.dns
      quiet: yes
      fail_msg: "Make sure all netplan variables are defined correctly"
      success_msg: "Looks Good!"
```
So, we use _stat_ and _debug_ to make sure that the file exists in the correct directory. Then we _load_ it in the play with _include_vars_ so we can have access to the variables, and finally we check the values with _assert_.

Finally, using _wait_for_ we check if there is connectivity to the target hosts and act accordingly. We need the _dynamic_hosts_ to be alive and the k8s node's IPs to be unreachable.
```yaml
- name: CHECK SSH CONNECTIVITY TO DHCP HOSTS
  wait_for:
    port: 22
    host: "{{item}}"
    search_regex: OpenSSH
    delay: 0
    timeout: 2
  loop: "{{groups.dhcp_hosts}}"

- name: CHECK SSH CONNECTIVITY TO K8S NODES
  wait_for:
    port: 22
    host: "{{hostvars[item].ansible_host}}"
    search_regex: OpenSSH
    delay: 0
    timeout: 2
    msg: Should not be alive
    state: stopped
  loop: "{{groups.control+groups.workers}}"
```

___
### The _init_ phase (Steps 01 and 02)
___
This phase calls two playbook files. As Step 01, we build the _dynamic_ host mapping to _static_ k8s node and we create the netplan config files for the hosts locally, thus this playbook is run against localhost. As Step 02, we upload the netplan files and apply the new configuration on the targets.

Here is the playbook for the first step:
```yaml
#!/usr/bin/env ansible-playbook
---
- name: "<! ################# INIT :: PREPARE FOR STATIC IPs ################# !>"
  hosts: localhost
  gather_facts: yes
  vars_files:
    - .secrets/passwd.yml
    - vars/netplan.yml
  
  
  tasks:
  - name: GET FACTS OF DHCP NODES
    setup:
    delegate_to: "{{ item }}"
    delegate_facts: true
    loop: "{{groups.dhcp_hosts}}"
    
  - name: PREPARE STATIC MAPPINGS
    set_fact: dhcp_map="{{ dhcp_map|default([]) + 
                       [{
                       'oldIP':hostvars[item.0].ansible_default_ipv4.address,
                       'intf':hostvars[item.0].ansible_default_ipv4.interface,
                       'newIP':hostvars[item.1].ansible_host
                       }]
                       }}"
    loop: "{{groups.dhcp_hosts|zip(groups.control+groups.workers)|list}}"                    
  
  - name: GENERATE NETPLAN CONFIGS
    template:
      src: netplan.j2
      dest: configs/netplan.{{item.oldIP}}
    loop: "{{dhcp_map}}"
    
```
<p style="background-color:deepskyblue;text-align:center"><b>init_play.yml</b></p>

We use the _setup_ module to connect to _dhcp_hosts_ and gather their facts. We are interested in their IPv4 assigned address and the network interface name. We then use _set_fact_ to build our list of dictionaries in order to use it for _jinja2_ template config creation.

A sample of the list of dictionaries looks like this:
```json
[
  {"oldIP":"192.168.1.203","intf":"ens3","newIP":"192.168.1.40"},
  {"oldIP":"192.168.1.204","intf":"ens3","newIP":"192.168.1.41"},
  {"oldIP":"192.168.1.205","intf":"ens3","newIP":"192.168.1.42"},
  {"oldIP":"192.168.1.206","intf":"ens3","newIP":"192.168.1.43"}
]
```
Once the list is populated, we use the _template_ module to get the configuration files and output them in the _configs_ directory appending the "OldIP" to the filename.

As a second step, we apply the configs to our target hosts by getting the netplan filename and replacing it with the respective netplan config file generated in the previous step. We make the change and wait for connectivity to the static IPs.
```yaml
#!/usr/bin/env ansible-playbook
---
- name: "<! ################# INIT :: CHANGE TO STATIC IPs ################### !>"
  hosts: dhcp_hosts
  gather_facts: yes
  vars_files:
    - "{{inventory_dir}}/.secrets/passwd.yml"

  tasks:
  - name: GET NETPLAN FILENAME
    shell: ls /etc/netplan
    register: netplan_file
 
  - name: UPLOAD NETPLAN CONFIGS
    copy:
      content: "{{lookup('file', '{{inventory_dir}}/configs/netplan.{{ansible_host}}')}}\n"
      dest: "/etc/netplan/{{netplan_file.stdout}}"
    become: yes

  - name: APPLY NETPLAN SETTINGS
    command: netplan apply
    become: yes
    async: 10
    poll: 0
  
  - name: CHECK CONNECTIVITY TO STATIC IPs
    wait_for:
      port: 22
      host: "{{hostvars[item].ansible_host}}"
      search_regex: OpenSSH
      delay: 20
      timeout: 120
    loop: "{{groups.control+groups.workers}}"
    connection: local
    run_once: yes

```
<p style="background-color:deepskyblue;text-align:center"><b>tasks/init/apply_netplan.yml</b></p>

___
### The _pre-deploy_ phase (Step 03)
___
Now that we have established that our targets will use their final static IPs, we are going to perform some tasks to prepare them for k8s deployment.

```yaml
#!/usr/bin/env ansible-playbook
---
- name: "<! ################# PRE :: PERFORM PRE-DEPLOYMENT TASKS ################### !>"
  hosts: all:!dhcp_hosts
  gather_facts: yes
  #any_errors_fatal: no
  vars_files:
    - .secrets/passwd.yml

  tasks:
  - name: "<======================== SSH KEYS ========================>"
    include_tasks: tasks/pre/sshkeys.yml
  
  - name: "<======================== SUDO ============================>"
    include_tasks: tasks/pre/sudo.yml
  
  - name: "<======================== CLOUD-INIT ======================>"
    include_tasks: tasks/pre/cloud-init.yml
  
  - name: "<======================== HOSTNAMES =======================>"
    include_tasks: tasks/pre/hostname.yml
  
  - name: "<======================== HOSTS FILES =====================>"
    include_tasks: tasks/pre/hosts.yml
  
  - name: "<======================== UPDATE/UPGRADE ==================>"
    include_tasks: tasks/pre/upgrade.yml
    
  - name: "<======================== REBOOT ========================->"
    include_tasks: tasks/pre/reboot.yml  

  - debug: msg="\u2705 NODE READY FOR DEPLOYMENT"
```
<p style="background-color:deepskyblue;text-align:center"><b>pre_deploy.yml</b></p>

We first generate an SSH key on localhost and distribute it to all the nodes in order for ansible to access them without using the user password. Then we enable passwordless sudo access for the ansible user. We disable cloud-init if the service is there. Set the correct hostname and configure all k8s nodes in the hosts files, and, finally perform pings between hosts to verify that name resolution and connectivity is successful.

___
### The _deploy_ phase (Step 04)
___
The last phase is to deploy the k8s cluster.
```yaml
#!/usr/bin/env ansible-playbook
---
- name: K8S DEPLOYMENT
  hosts: all:!dhcp_hosts
  gather_facts: yes
  vars_files:
    - .secrets/passwd.yml

  tasks:
  - name: "<======================== PRE-REQUISITES ===================>"
    include_tasks: tasks/deploy/packages_general.yml
    args:
      apply:
        become: yes
  
  - name: "<======================== TURN OFF SWAP ====================>"
    include_tasks: tasks/deploy/swap.yml
  
  - name: "<======================== DOCKER CRI =======================>"
    include_tasks: tasks/deploy/cri.yml
    args:
      apply:
        become: yes
  
  - name: "<======================== KUBE PACKAGES ====================>"
    include_tasks: tasks/deploy/packages_kube.yml
    args:
      apply:
        become: yes

  - name: "<======================= PREPARE THE CONTROL NODE ==========>"
    block:
      - name: "<======================== INIT CONTROL NODE ==========>"
        include_tasks: tasks/deploy/boot_control.yml
      
      - name: "<======================== DEPLOY CNI =================>"
        include_tasks: tasks/deploy/cni.yml
    when: inventory_hostname in groups.control
    
  - name: "<===================== ADD WORKER NODES  ====================>"
    include_tasks: tasks/deploy/workers.yml
  
```
<p style="background-color:deepskyblue;text-align:center"><b>deployment.yml</b></p>

We start off by installing the prerequisite packages, apt keys and repositories. We then turn off swap if any, in order for _kubelet_ service to run without issues. Then, we proceed installing docker CRI, changing cgroup to _systemd_ and assigning the user to docker group. We download _kubeadm_, _kubectl_, and _kubelet_ packages. Next, we initialise the control node and install the network CNI plugin. Finally, we join the worker nodes to the cluster.
___
## Optimisations
___
If we've reached this stage, it means that everything is working fine, we are happy, so the code is good and we do not need any optimisations or fine tuning :smile:. Well, there is always room for improvement and fine tuning, the only enemy is time.

I am sure that a more experienced eye could spot many ways to improve the playbook and suggest better ways to do things or use tasks, but here are my observations after finishing the playbook:

- **Improving Speed**: During the _check_ phase, where we check for reachability, I initially used to ping the hosts and act on the result. This was adding a nearly 45 second delay in execution, so I tested with _wait_for_ towards SSH connectivity and this improved script time tremendously. After all, SSH connectivity is somewhat better than ping reachability, since it is one step further :smile:. What I am suggesting here is to take in mind the end goal of what you are after and figure out a way to do it more meaningful and perhaps faster. For example, if you have a task to create a file in a directory, should you first check if the directory exists? Well, it depends on the use case, but in general the task to create the file will fail if the directory does not exist in the first place and you would be able catch this.
- **Task Consolidation**: Although this playbook does the job, I think it is just automating a list of steps to achieve the result like one could perform manually on a system. Let's take for example the _apt_ module that installs packages.  The module is called several times to install packages according to the phase of the playbook, but what about if we just used a single _apt_ task to install all our needed packages from all phases. It would be like having a _package installation_ phase. Unless for some reason we need discrete stages and actions, I think that looking at the playbook as a holistic entity most probably will reveal tasks that can be consolidated.
- **Task Reduction**: Well, here, the main focus is about the question should I use several tasks to do something or it can be done with a single task or less. As an example, we need to check for the existence of a file. We use the _stat_ module and register a variable. We then use the _debug_ module to check the output for success or not. For sure, it will depend on the use case, but another way of treating this could be by just the _debug_ module and using a file lookup conditional clause for this task.
- **Best Practices**: Here, I will not expand more on using ansible roles, or group_vars folder, or avoiding the declarations of variables in the inventory file :smile:




<p align="right">...till next time...<em>have fun!</em></p>