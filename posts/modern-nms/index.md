# If This Ain&#39;t a Modern NMS, Then What Is?

---
## Intro

In this post we will go through a detailed how to on executing Ansible playbooks triggered by a webhook notification event raised in Kentik Portal.  The use case is to have visibility into BGP Flowspec metrics of the devices during mitigations and see the relevant counters in the Portal under Kentik&#39;s NMS Metrics Explorer.

You may find all relevant files in my [repo](https://github.com/becos76/kentik-eda).

---
## The Intent

For the webhook receiver part, we are going to use [Kentik&#39;s ansible_eda](https://github.com/kentik/ansible_eda) collection that will _listen_ for a mitigation notification event. Once the event is received and a mitigation is started, EDA will trigger the execution of a playbook to handle the event and spin-up Telegraf in order to start polling the devices for BGP Flowspec streaming telemetry counters while reporting them back to the Portal in influx line format via HTTPS. 

Once the mitigation is over and EDA receives the respective _cease_ notification, a check for any active mitigations on the devices is done via Kentik&#39;s API and if there are no active mitigations on the devices, EDA will trigger Telegraf to stop.  If there are still on-going mitigations, Telegraf will continue to poll and ship metrics till we receive the last mitigation&#39;s notification.

---
## Lab Setup

Here is how the lab has been set-up for this:
- Two Cisco IOS XRv 9000 devices defined in the portal with established BGP sessions and Flowspec family enabled. GRPC is configured and enabled on the devices.
- A mitigation Platform defined in the Portal that includes both devices, and two mitigation methods attached. One will block ICMP echo-requests and the other will Rate Limit SSH protocol
- A notification channel of type JSON defined in the portal and attached to both mitigation methods{{&lt; admonition type=note open=false &gt;}} I chose not to use any Alerting Policies with this and trigger all mitigations manually in order to speed things up {{&lt; /admonition &gt;}}
- An Ubuntu VM (jammy) with docker installed
	- EDA will run inside a docker container with Traefik  _proxying_ the webhook events
	- Once an _actionable_ event is received, EDA will control a Telegraf docker container accordingly through a playbook

---
## Discovery

We will start by exploring what we see on the devices during a running flowspec mitigation. We have triggered two manual mitigations in the Portal and those are currently active on the devices:
```
RP/0/RP0/CPU0:ATH-POP1-XRV1#show flowspec afi-all detail

AFI: IPv4
  Flow           :Dest:10.10.10.11/32,ICMPType:=8
    Actions      :Traffic-rate: 0 bps  (bgp.1)
  Flow           :Source:10.10.10.12/32,Proto:=6,DPort:=22
    Actions      :Traffic-rate: 160000 bps  (bgp.1)
```
{{&lt; admonition failure &#34;XRv9k limitations&#34; false&gt;}}Unfortunatelly the XRv has a limited data plane, so we do not get any _action_ counters on the mitigations - this and also no netflow out of this virtual device :cry:. In case of a _real_ XR device the output would be similar to this:
```
REAL-XR#show flowspec afi-all detail

AFI: IPv4
  Flow           :Dest:10.10.10.11/32,ICMPType:=8
    Actions      :Traffic-rate: 0 bps  (bgp.1)
	Statisctics                       (packets/bytes)
	  Matched         :                       10/640
	  Dropped         :                       10/640
```

{{&lt; /admonition &gt;}}

So we have two mitigations as expected. Let&#39;s find out which YANG model those are defined under. After trying some show commands for the xpath, there it is:
```
RP/0/RP0/CPU0:ATH-POP1-XRV1#schema-describe &#34;show flowspec afi-all detail&#34;

Action: get
Path:   RootCfg.ASNFormat

Action: get_children
Path:   RootOper.FlowSpec.VRF({&#39;VRFName&#39;: &#39;default&#39;}).AF

Action: get
Path:   RootOper.FlowSpec.VRF({&#39;VRFName&#39;: &#39;default&#39;}).AF({&#39;AFName&#39;: &#39;IPv4&#39;}).Flow

RP/0/RP0/CPU0:ATH-POP1-XRV1#show telemetry internal xpath &#34;show flowspec afi-all detail&#34;

Error: Invalid input
RP/0/RP0/CPU0:ATH-POP1-XRV1#show telemetry internal xpath &#34;show flowspec afi-all&#34;

Error: Invalid input
RP/0/RP0/CPU0:ATH-POP1-XRV1#show telemetry internal xpath &#34;show flowspec summary&#34;

Cisco-IOS-XR-flowspec-oper:flow-spec/summary

RP/0/RP0/CPU0:ATH-POP1-XRV1#show telemetry internal json Cisco-IOS-XR-flowspec-oper:flow-spec | include path

  &#34;encoding_path&#34;: &#34;Cisco-IOS-XR-flowspec-oper:flow-spec/vrfs/vrf/afs/af/flows/flow&#34;,
  &#34;encoding_path&#34;: &#34;Cisco-IOS-XR-flowspec-oper:flow-spec/vrfs/vrf/afs/af/nlris/nlri&#34;,
  &#34;encoding_path&#34;: &#34;Cisco-IOS-XR-flowspec-oper:flow-spec/vrfs/vrf/afs/af/table-summary&#34;,
  &#34;encoding_path&#34;: &#34;Cisco-IOS-XR-flowspec-oper:flow-spec/summary&#34;,
  &#34;encoding_path&#34;: &#34;Cisco-IOS-XR-flowspec-oper:flow-spec/clients/client&#34;,

```
Now we know the YANG model and the xpath, and we can get the metrics out of. We will test it with `gnmic` to see if it works and get the details of the tags/paths returned:
```json
❯ gnmic -a 10.12.255.1:57344 -u &lt;device_username&gt; -p &lt;device_password&gt; --skip-verify prompt
gnmic&gt; get --path Cisco-IOS-XR-flowspec-oper:flow-spec/vrfs/vrf/afs/af/flows/flow -e json_ietf --format event
[
  {
    &#34;name&#34;: &#34;get-request&#34;,
    &#34;timestamp&#34;: 1716762517741698080,
    &#34;tags&#34;: {
      &#34;af_af-name&#34;: &#34;IPv4&#34;,
      &#34;flow_flow-notation&#34;: &#34;Dest:10.10.10.11/32,ICMPType:=8&#34;,
      &#34;source&#34;: &#34;10.12.255.1:57344&#34;,
      &#34;vrf_vrf-name&#34;: &#34;default&#34;
    },
    &#34;values&#34;: {
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/active-flow-client/action.0/dscp&#34;: 0,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/active-flow-client/action.0/ipv4-nh&#34;: &#34;0.0.0.0&#34;,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/active-flow-client/action.0/ipv6-nh&#34;: &#34;::&#34;,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/active-flow-client/action.0/rate&#34;: &#34;0&#34;,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/flow-notation&#34;: &#34;Dest:10.10.10.11/32,ICMPType:=8&#34;,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/flow-statistics/classified/bytes&#34;: &#34;0&#34;,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/flow-statistics/classified/packets&#34;: &#34;0&#34;,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/flow-statistics/dropped/bytes&#34;: &#34;0&#34;,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/flow-statistics/dropped/packets&#34;: &#34;0&#34;,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/destination-prefix-ipv4/mask&#34;: &#34;255.255.255.255&#34;,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/destination-prefix-ipv4/prefix&#34;: &#34;10.10.10.11&#34;,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/destination-prefix-ipv6/mask&#34;: 0,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/destination-prefix-ipv6/prefix&#34;: &#34;::&#34;,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/icmp/code&#34;: 255,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/icmp/type&#34;: 8,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/source-prefix-ipv4/mask&#34;: &#34;0.0.0.0&#34;,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/source-prefix-ipv4/prefix&#34;: &#34;0.0.0.0&#34;,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/source-prefix-ipv6/mask&#34;: 0,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/source-prefix-ipv6/prefix&#34;: &#34;::&#34;,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/tcp-flag/match-any&#34;: false,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/tcp-flag/value&#34;: 0
    }
  },
  {
    &#34;name&#34;: &#34;get-request&#34;,
    &#34;timestamp&#34;: 1716762517741698080,
    &#34;tags&#34;: {
      &#34;af_af-name&#34;: &#34;IPv4&#34;,
      &#34;flow_flow-notation&#34;: &#34;Source:10.10.10.12/32,Proto:=6,DPort:=22&#34;,
      &#34;source&#34;: &#34;10.12.255.1:57344&#34;,
      &#34;vrf_vrf-name&#34;: &#34;default&#34;
    },
    &#34;values&#34;: {
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/active-flow-client/action.0/dscp&#34;: 0,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/active-flow-client/action.0/ipv4-nh&#34;: &#34;0.0.0.0&#34;,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/active-flow-client/action.0/ipv6-nh&#34;: &#34;::&#34;,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/active-flow-client/action.0/rate&#34;: &#34;160000&#34;,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/flow-notation&#34;: &#34;Source:10.10.10.12/32,Proto:=6,DPort:=22&#34;,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/flow-statistics/classified/bytes&#34;: &#34;0&#34;,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/flow-statistics/classified/packets&#34;: &#34;0&#34;,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/flow-statistics/dropped/bytes&#34;: &#34;0&#34;,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/flow-statistics/dropped/packets&#34;: &#34;0&#34;,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/destination-port/uint16_rng_array.0/max&#34;: 22,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/destination-port/uint16_rng_array.0/min&#34;: 22,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/destination-prefix-ipv4/mask&#34;: &#34;0.0.0.0&#34;,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/destination-prefix-ipv4/prefix&#34;: &#34;0.0.0.0&#34;,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/destination-prefix-ipv6/mask&#34;: 0,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/destination-prefix-ipv6/prefix&#34;: &#34;::&#34;,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/icmp/code&#34;: 0,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/icmp/type&#34;: 0,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/ip-protocol/uint16_rng_array.0/max&#34;: 6,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/ip-protocol/uint16_rng_array.0/min&#34;: 6,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/source-prefix-ipv4/mask&#34;: &#34;255.255.255.255&#34;,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/source-prefix-ipv4/prefix&#34;: &#34;10.10.10.12&#34;,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/source-prefix-ipv6/mask&#34;: 0,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/source-prefix-ipv6/prefix&#34;: &#34;::&#34;,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/tcp-flag/match-any&#34;: false,
      &#34;/Cisco-IOS-XR-flowspec-oper:/flow-spec/vrfs/vrf/afs/af/flows/flow/matches/tcp-flag/value&#34;: 0
    }
  }
]
```

---
## Kentik EDA

We are going to start off by explaining the file and folder structure giving a bit of info of how this works. The idea behind this is to have EDA running as a docker container. Traefik will handle reverse proxying the webhooks to EDA and in case a new mitigation is happening, then a telegraf docker container will spin up and start collecting gnmi metrics from the devices and pushing them to the Portal. Once the mitigation is over, EDA will receive the event to stop the mitigation.

Now, at this point, since more than one mitigations can be ongoing on the devices, we are going to focus on the specific mitigation Platform that will always include our devices. So any Method under the specific mitigation Platform will cause the start of the metrics collection.  Upon receiving a stop event on this Platform, we just have to make sure that this event is the _last_ one on the devices, and we can verify this via Kentik API requesting all active alerts in the portal of type Mitigation. If none exists, then we can assume that the event EDA received was the last one for the Platform.

In summary, here are the features delivered:
- Traefik is handling the proxying of webhooks to the appropriate path that Kentik EDA is set up to receive
- Kentik EDA processes only the relevant mitigation events coming in excluding the rest
- The playbook will dynamically produce the telegraf configuration file according to our defined variables in order to ship the metrics in the Portal

### Directory Structure

```Bash
.
├── docker-compose.yaml         &gt;-- How to bring up our services
├── Dockerfile                  &gt;-- How to build the EDA image
├── .env                        &gt;-- Hidden file containing sensitive data to be passed as environment variables
├── .env.sample                 &gt;-- Example env file
└── eda                         &gt;-- EDA config folder to be mounted on the container
    ├── ansible.cfg             &gt;-- Ansible configuration file picked up by default
    ├── ansible-inventory.yml   &gt;-- Simple inv file including only localhost
    ├── eda_vars.yml            &gt;-- Definition of the related variables used in the project
    ├── mitigation.yml          &gt;-- Playbook to handle events received
    ├── rules.yml               &gt;-- Rulebook defining our EDA logic
    └── telegraf                
        ├── telegraf.conf.j2    &gt;-- Jinja2 template producing the configuration dynamically
        └── telegraf.conf       &gt;-- Actual config to be used with the telegraf container
       
```

### Dockerfile

We are installing the dependencies and ansible needed collections for Kentik EDA to run. We are going to run everything under the `/app` directory inside the container

```Dockerfile
FROM quay.io/centos/centos:stream9-development

RUN dnf install -y java-17-openjdk-devel python3-pip gcc python3-devel postgresql-devel

ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk

RUN pip install -U pip \
    &amp;&amp; pip install ansible-core \
    ansible-rulebook \
    ansible-runner \
    psycopg requests \
    &amp;&amp; ansible-galaxy collection install kentik.ansible_eda community.docker

ARG APP_DIR=${APP_DIR:-/app}

WORKDIR $APP_DIR

RUN chmod -R 0775 $APP_DIR

```
### Compose

Our compose file will bring up two services. 
- **traefik**: that will listen for HTTP and will forward everything received at the `/eda` path to the EDA container replacing the path to `/alert`, since this is the path that Kentik EDA webhook listens on, and port `8080`. 
- **kentik-eda**: Our `eda` folder is mounted at the `/app` path inside the container, and contains all the files needed to run our logic. We also mount the docker unix socket to the container so that we can control the containers from within the EDA one. We also pass our variables to the container environment and we instruct the container to start the rulebook passing also the variables files. {{&lt; admonition warning &#34;Avoid using this in production!!!&#34; false &gt;}}Security wise it is not the best to have a docker container controlling the host&#39;s containers by exposing the unix socket to it. :smile: {{&lt; /admonition &gt;}}

```yaml
---
services:
  traefik:
    image: traefik
    container_name: traefik
    command: &gt;
      --api.insecure=true
      --providers.docker
      --providers.docker.exposedbydefault=false
      --accesslog=true
      --entrypoints.eda.address=:80
      #--log.level=DEBUG
    ports:
      - 80:80
      - 8080:8080
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
  kentik-eda:
    #scale: 2
    image: kentik-eda:0.1
    container_name: kentik-eda
    depends_on:
      - traefik
    build:
      context: .
    volumes:
      - ${PWD}/eda:/app
      - /var/run/docker.sock:/var/run/docker.sock:ro
    env_file:
      - .env
    ports:
      - 8080
    command: bash -c &#34;ansible-rulebook --rulebook rules.yml -i ./ansible-inventory.yml --vars eda_vars.yml&#34;
    labels:
      - &#34;traefik.enable=true&#34;
      - &#34;traefik.http.routers.eda.rule=Host(`kentik.eda`) &amp;&amp; Path(`/eda`)&#34;
      - &#34;traefik.http.routers.eda.middlewares=eda-ratelimit,eda-path&#34;
      - &#34;traefik.http.middlewares.eda-path.replacepath.path=/alert&#34;
      - &#34;traefik.http.middlewares.eda-ratelimit.ratelimit.average=10&#34;
      - &#34;traefik.http.middlewares.eda-ratelimit.ratelimit.burst=50&#34;
      - &#34;traefik.http.routers.eda.entrypoints=eda&#34;
```
Here is the example `.env` file showing the variables needed to be exposed inside the EDA container environment:
```Bash
KENTIK_API_TOKEN=&lt;your api token&gt;
KENTIK_API_EMAIL=&lt;your portal email&gt;
KENTIK_API_ENDPOINT=&#34;https://grpc.api.kentik.eu/kmetrics/v202207/metrics/api/v2/write?bucket=&amp;org=&amp;precision=ns&#34;
GRPC_USERNAME=&lt;device username&gt;
GRPC_PASSWORD=&lt;device password&gt;
```


We can bring everything up with `docker compose up --build`
```bash
❯ docker compose up --build --force-recreate --dry-run
[&#43;] Building 0.0s (0/0)                                                                                  docker:default
[&#43;] Running 5/0
 ✔ DRY-RUN MODE -    build service kentik-eda                                                                      0.0s
 ✔ DRY-RUN MODE -  ==&gt; ==&gt; writing image dryRun-648b28d83dd200d4e7709ac3a5d522f8244467bd                           0.0s
 ✔ DRY-RUN MODE -  ==&gt; ==&gt; naming to kentik-eda:0.1                                                                0.0s
 ✔ DRY-RUN MODE -  Container traefik                                                     Recreated                 0.0s
 ✔ DRY-RUN MODE -  Container kentik-eda                                                  Recreated                 0.0s
end of &#39;compose up&#39; output, interactive run is not supported in dry-run mode
```
### Rulebook rules

Here is how we have configured our rules:
```YAML
---
- name: Listening for Webhook Events
  hosts: localhost
  sources:
    - kentik.ansible_eda.kentik_webhook:
        host: 0.0.0.0
        port: 8080
  rules:
    - name: R1 - New Event Received
      # If it is a valid start or stop mitigation event
      condition: event.payload is defined and
                 event.payload.CompanyID == vars.CompanyID and
                 event.payload.EventType == vars.EventType and
                 event.payload.MitigationPlatformID == vars.MitigationPlatformID and
                 event.payload.MitigationState in vars.ValidMitigationStates and
                 event.payload.MitigationStateNew in vars.ValidMitigationStates
      actions:
        - debug:
            msg: |
              New {{event.payload.MitigationType}}/{{event.payload.MitigationState}} event received
              ID: {{event.payload.MitigationID}}
              Platform: {{event.payload.MitigationPlatformName}}
              Method: {{event.payload.MitigationMethodName}}
              IP: {{event.payload.MitigationAlertIP}}

        # DEBUG:Dump the event
        #- print_event:
        #    pretty: true

        # Call the pb to handle the mitigation event
        - run_playbook:
            name: mitigation.yml

    # Catch and ignore the rest
    - name: R2 - Not taking action
      condition: event.meta is defined
      action:
        debug:
          msg:
            - &#34;Ignoring {{event.payload.EventType}} event&#34;

```
&lt;p style=&#34;background-color:skyblue;text-align:center&#34;&gt;&lt;b&gt;eda/rules.yml&lt;/b&gt;&lt;/p&gt;
and our variables:

```YAML
---
CompanyID: &lt;REDACTED&gt;
EventType: &#34;mitigation&#34;
MitigationPlatformID: &#34;257&#34;
ValidMitigationStates:
    - &#34;manualMitigating&#34;
    - &#34;mitigating&#34;
    - &#34;archived&#34;
Mitigation:
    devices:
        - name: &#34;ath-pop1-xrv1&#34;
          ip: &#34;10.12.255.1&#34;
          port: 57344
        - name: &#34;ath-pop1-xrv2&#34;
          ip: &#34;10.13.255.1&#34;
          port: 57344
```
&lt;p style=&#34;background-color:skyblue;text-align:center&#34;&gt;&lt;b&gt;eda/eda_vars.yml&lt;/b&gt;&lt;/p&gt;

As a condition we check the event payload against certain values in order to process it further, e.g. the CompanyID , the EventType and the MitigationPlatformID must match to what we have configured and also the EventState must be one of the _actionable_ states that we have defined in our dictionary. If we have a matching event then we pass control to the `mitigation.yml` playbook to handle the event further.

---
## Ansible Playbook

We could have had separate playbooks for the different states of the alerts received, i.e. separate conditions in the rules file, but we chose here to proceed with just one playbook to handle both cases.

A brief pseudocode of the playbook could be:
```Bash
#IF event state is &#39;mitigating&#39;
	#IF Telegraf is not running
		- Generate telegraf config from template
		- Bring up the container
#ELSE IF event state is &#39;archived&#39;
	#IF no active mitigation alerts in portal for PlatormID
		- Stop telegraf container
```
{{&lt; details &#34;Here is a sequence diagram showing the workflows&#34; &gt;}}
```mermaid
sequenceDiagram
  autonumber
  participant Portal
  participant EDA
  Portal-&gt;&gt;EDA: Alerts
  loop Listen
    EDA-&gt;&gt;EDA: Check Platform and State (Start/Stop)
    create participant Playbook
    EDA-&gt;&gt;Playbook: Process Valid Alert  
  end
  alt Mitigation Started
    Playbook-&gt;&gt;Docker: Is Telegraf Running?
    Docker--&gt;&gt;Playbook: State
    alt Telegraf Running
      Playbook-&gt;&gt;Playbook: Do nothing
    else Telegraf Down
      Playbook-&gt;&gt;Playbook: Create Telegraf config
      Playbook-&gt;&gt;Docker: Start Telegraf
      create participant Telegraf
      Docker-&gt;&gt;Telegraf: Run Container
      loop
        create participant Devices
        Telegraf-&gt;&gt;Devices: Fetch metrics
        Telegraf-&gt;&gt;Portal: Ship metrics
      end
    end
  else Mitigation Finished
    Playbook-&gt;&gt;Portal: Get active mitigations
    Portal--&gt;&gt;Playbook: Active Mitigations
    alt Active Mitigations on Platform
      Playbook-&gt;&gt;Playbook: Do nothing
    else No Active Mitigations on Platform
      Playbook-&gt;&gt;Docker: Stop Telegraf
      Docker-&gt;&gt;Telegraf: Container Down
      destroy Telegraf
    end
  end
```
{{&lt; /details &gt;}}



And here is the playbook. Two blocks were used to differentiate between the start and stop workflows. For the telegraf container the configuration file is dynamically produced through a jinja2 template and this is mounted within the container. This is achieved by specifying the full host path of the file, which is also relatively mounted within the EDA container, i.e. shared.

```YAML
---
- name: &#34;::HANDLE MITIGATION EVENT::&#34;
  gather_facts: no
  hosts: localhost
  vars_files: eda_vars.yml
  tasks:
    - name: START - NEW MITIGATION STARTING
      block: 
      
      - name: START::IS TELEGRAF RUNNING
        community.docker.docker_container_info:
          name: telegraf-eda
        register: result
     
      - name: START::GENERATE TELEGRAF CONFIG
        ansible.builtin.template:
          src: /app/telegraf/telegraf.conf.j2
          dest: /app/telegraf/telegraf.conf
        when: not result.exists|bool      
      
      - name: START::BRING UP CONTAINER
        community.docker.docker_container:
          name: telegraf-eda
          image: telegraf:latest
          state: started
          volumes:
            - &#34;/opt/projects/kentik-eda/eda/telegraf/telegraf.conf:/etc/telegraf/telegraf.conf&#34;
          env:
            KENTIK_API_EMAIL: &#34;{{ lookup(&#39;ansible.builtin.env&#39;, &#39;KENTIK_API_EMAIL&#39;)}}&#34;
            KENTIK_API_TOKEN: &#34;{{ lookup(&#39;ansible.builtin.env&#39;, &#39;KENTIK_API_TOKEN&#39;)}}&#34;
            GRPC_USERNAME: &#34;{{ lookup(&#39;ansible.builtin.env&#39;, &#39;GRPC_USERNAME&#39;)}}&#34;
            GRPC_PASSWORD: &#34;{{ lookup(&#39;ansible.builtin.env&#39;, &#39;GRPC_PASSWORD&#39;)}}&#34;
        when: not result.exists|bool      
      
      when: &#34;&#39;mitigating&#39; in ansible_eda.event.payload.MitigationState|lower and 
            &#39;mitigating&#39; in ansible_eda.event.payload.MitigationStateNew|lower&#34;
    
    - name: MITIGATION FINISHED
      block: 
      
      - name: STOP::GET ACTIVE ALERTS FROM KENTIK
        ansible.builtin.uri:
         url: https://api.kentik.eu/api/v5/alerts-active/alarms
         method: GET
         http_agent: ansible-eda-httpget
         headers:
           X-CH-Auth-API-Token: &#34;{{ lookup(&#39;ansible.builtin.env&#39;, &#39;KENTIK_API_TOKEN&#39;)}}&#34; 
           X-CH-Auth-Email: &#34;{{ lookup(&#39;ansible.builtin.env&#39;, &#39;KENTIK_API_EMAIL&#39;)}}&#34;
        register: alerts

      - name: STOP::CHECK KENTIK FOR ACTIVE MITIGATIONS
        ansible.builtin.debug: 
          msg: 
            - &#34;Current Active Mitigations on Platform ID#{{MitigationPlatformID}}: {{alerts.json | 
               selectattr(&#39;mit_platform_id&#39;, &#39;match&#39;, ansible_eda.event.payload.MitigationPlatformID ) |
              selectattr(&#39;alarm_state&#39;, &#39;search&#39;, &#39;MITIGATING&#39;) | length}}&#34;
                  
      - name: STOP::REMOVE TELEGRAF CONTAINER
        community.docker.docker_container:
          name: telegraf-eda
          state: absent

        when: alerts.json | 
              selectattr(&#39;mit_platform_id&#39;, &#39;match&#39;, ansible_eda.event.payload.MitigationPlatformID ) |
              selectattr(&#39;alarm_state&#39;, &#39;search&#39;, &#39;MITIGATING&#39;) | length == 0
      
      when: &#34;&#39;archived&#39; in ansible_eda.event.payload.MitigationState|lower and
            &#39;archived&#39; in ansible_eda.event.payload.MitigationStateNew|lower&#34;
```
&lt;p style=&#34;background-color:skyblue;text-align:center&#34;&gt;&lt;b&gt;eda/mitigation.yml&lt;/b&gt;&lt;/p&gt;

### Telegraf configuration

When it comes to telegraf, we chose to have the config generated dynamically before the container starts. In this way we can:
- Specify the devices&#39; attributes in the variables file and deduce the gnmi inputs from them
- Include the MitigationPlatformID as a tag along with all other event details
- Perform a _lookup_ to include DEVICE_IP and DEVICE_NAME along with the tags. This was implemented via an inline starlark script referencing a lookup dictionary that is dynamically constructed from our devices dictionary.
- All sensitive data are passed from the EDA container environment and instantiated via docker when the container is brought up.

Here is the template:
```toml
[agent]
  omit_hostname = true
  debug = true
  quiet = false

[global_tags]
  platform_id = &#34;{{ MitigationPlatformID }}&#34;

[[inputs.gnmi]]

  addresses = [{% for device in Mitigation.devices %}&#34;{{device.ip}}:{{device.port}}&#34;{% if not loop.last %},{% endif %}{% endfor %}]
  username = &#34;${GRPC_USERNAME}&#34;
  password = &#34;${GRPC_PASSWORD}&#34;
  redial = &#34;10s&#34;
  encoding = &#34;proto&#34;
  tls_enable = true
  insecure_skip_verify = true

[[inputs.gnmi.subscription]]
  name = &#34;/devices/xrv9000/flowspec&#34;
  origin = &#34;Cisco-IOS-XR-flowspec-oper&#34;
  path = &#34;/flow-spec/vrfs/vrf/afs/af/flows/flow/flow-statistics/&#34;
  subscription_mode = &#34;sample&#34;
  sample_interval = &#34;30s&#34;

[[processors.rename]]
  [[processors.rename.replace]]
    tag = &#34;source&#34;
    dest = &#34;device_ip&#34;

[[processors.override]]
  [processors.override.tagpass]
    vrf_name = [&#34;&#34;]
  [processors.override.tags]
    vrf_name = &#34;default&#34;

[[processors.starlark]]
  source=&#39;&#39;&#39;
lookup = {
{% for device in Mitigation.devices %}
  &#34;{{ device.ip }}&#34;: &#34;{{ device.name }}&#34;,
{% endfor %}}
def apply(metric):
    if metric.tags[&#39;device_ip&#39;] and metric.tags[&#39;device_ip&#39;] in lookup:
       metric.tags[&#39;device_name&#39;] = lookup[metric.tags[&#39;device_ip&#39;]]
    return metric
&#39;&#39;&#39;

[[outputs.file]]
  files = [&#34;stdout&#34;]
  data_format = &#34;influx&#34;
  influx_sort_fields = false
  tagexclude = [&#34;path&#34;]

[[outputs.http]]
  url = &#34;{{ lookup(&#39;env&#39;, &#39;KENTIK_API_ENDPOINT&#39;)}}&#34;
  data_format = &#34;influx&#34;
  influx_sort_fields = false
  tagexclude = [&#34;path&#34;]

  [outputs.http.headers]
    Content-Type = &#34;application/influx&#34;
    X-CH-Auth-Email = &#34;${KENTIK_API_EMAIL}&#34;
    X-CH-Auth-API-Token = &#34;${KENTIK_API_TOKEN}&#34;
```
&lt;p style=&#34;background-color:skyblue;text-align:center&#34;&gt;&lt;b&gt;eda/telegraf/telegraf.conf.j2&lt;/b&gt;&lt;/p&gt;

And the respective config file produced to be picked up by docker:
```toml
[agent]
  omit_hostname = true
  debug = true
  quiet = false

[global_tags]
  platform_id = &#34;257&#34;

[[inputs.gnmi]]

  addresses = [&#34;10.12.255.1:57344&#34;,&#34;10.13.255.1:57344&#34;]
  username = &#34;${GRPC_USERNAME}&#34;
  password = &#34;${GRPC_PASSWORD}&#34;
  redial = &#34;10s&#34;
  encoding = &#34;proto&#34;
  tls_enable = true
  insecure_skip_verify = true

[[inputs.gnmi.subscription]]
  name = &#34;/devices/xrv9000/flowspec&#34;
  origin = &#34;Cisco-IOS-XR-flowspec-oper&#34;
  path = &#34;/flow-spec/vrfs/vrf/afs/af/flows/flow/flow-statistics/&#34;
  subscription_mode = &#34;sample&#34;
  sample_interval = &#34;30s&#34;

[[processors.rename]]
  [[processors.rename.replace]]
    tag = &#34;source&#34;
    dest = &#34;device_ip&#34;

[[processors.override]]
  [processors.override.tagpass]
    vrf_name = [&#34;&#34;]
  [processors.override.tags]
    vrf_name = &#34;default&#34;

[[processors.starlark]]
  source=&#39;&#39;&#39;
lookup = {
  &#34;10.12.255.1&#34;: &#34;ath-pop1-xrv1&#34;,
  &#34;10.13.255.1&#34;: &#34;ath-pop1-xrv2&#34;,
}
def apply(metric):
    if metric.tags[&#39;device_ip&#39;] and metric.tags[&#39;device_ip&#39;] in lookup:
       metric.tags[&#39;device_name&#39;] = lookup[metric.tags[&#39;device_ip&#39;]]
    return metric
&#39;&#39;&#39;

[[outputs.file]]
  files = [&#34;stdout&#34;]
  data_format = &#34;influx&#34;
  influx_sort_fields = false
  tagexclude = [&#34;path&#34;]

[[outputs.http]]
  url = &#34;https://grpc.api.kentik.eu/kmetrics/v202207/metrics/api/v2/write?bucket=&amp;org=&amp;precision=ns&#34;
  data_format = &#34;influx&#34;
  influx_sort_fields = false
  tagexclude = [&#34;path&#34;]

  [outputs.http.headers]
    Content-Type = &#34;application/influx&#34;
    X-CH-Auth-Email = &#34;${KENTIK_API_EMAIL}&#34;
    X-CH-Auth-API-Token = &#34;${KENTIK_API_TOKEN}&#34;
```
&lt;p style=&#34;background-color:skyblue;text-align:center&#34;&gt;&lt;b&gt;eda/telegraf/telegraf.conf&lt;/b&gt;&lt;/p&gt;

---
## Moment of Truth

After starting some manual mitigations, telegraf will ship the gnmi metrics to the Portal and those will be available under the `/devices/xrv9000/flowspec` custom schema path based on our configuration in the [`telegraf.conf`](#telegraf-configuration)file.

Here is how it looks like in the Metrics Explorer
{{&lt; image src=&#34;mot.png&#34; caption=&#34;Flowspec metrics in the Portal&#34;&gt;}}

Here are some console outputs from EDA running:

```Ansible
** 2024-05-26 16:00:04.559137 [debug] ******************************************
Ignoring mitigation event
********************************************************************************

** 2024-05-26 16:00:18.406938 [debug] ******************************************
New manual/manualMitigating event received
ID: 10108
Platform: XR-FlowSpec
Method: Discard ICMP echo-request
IP: 10.10.10.11/32
********************************************************************************

PLAY [::HANDLE MITIGATION EVENT::] *********************************************

TASK [START::IS TELEGRAF RUNNING] **********************************************
ok: [localhost]

TASK [START::GENERATE TELEGRAF CONFIG] *****************************************
ok: [localhost]

TASK [START::BRING UP CONTAINER] ***********************************************
changed: [localhost]

TASK [STOP::GET ACTIVE ALERTS FROM KENTIK] *************************************
skipping: [localhost]

TASK [STOP::CHECK KENTIK FOR ACTIVE MITIGATIONS] *******************************
skipping: [localhost]

TASK [STOP::REMOVE TELEGRAF CONTAINER] *****************************************
skipping: [localhost]

PLAY RECAP *********************************************************************
localhost                  : ok=3    changed=1    unreachable=0    failed=0    skipped=3    rescued=0    ignored=0
```
&lt;p style=&#34;background-color:skyblue;text-align:center&#34;&gt;&lt;b&gt;New mitigation&lt;/b&gt;&lt;/p&gt;

```Ansible
** 2024-05-26 16:10:20.682550 [debug] ******************************************
New manual/archived event received
ID: 10111
Platform: XR-FlowSpec
Method: Rate Limit 20k TCP SSH
IP: 10.10.10.15/32
********************************************************************************

PLAY [::HANDLE MITIGATION EVENT::] *********************************************

TASK [START::IS TELEGRAF RUNNING] **********************************************
skipping: [localhost]

TASK [START::GENERATE TELEGRAF CONFIG] *****************************************
skipping: [localhost]

TASK [START::BRING UP CONTAINER] ***********************************************
skipping: [localhost]

TASK [STOP::GET ACTIVE ALERTS FROM KENTIK] *************************************
ok: [localhost]

TASK [STOP::CHECK KENTIK FOR ACTIVE MITIGATIONS] *******************************
ok: [localhost] =&gt; {
    &#34;msg&#34;: [
        &#34;Current Active Mitigations on Platform ID#257: 3&#34;
    ]
}

TASK [STOP::REMOVE TELEGRAF CONTAINER] *****************************************
skipping: [localhost]

PLAY RECAP *********************************************************************
localhost                  : ok=2    changed=0    unreachable=0    failed=0    skipped=4    rescued=0    ignored=0

```
&lt;p style=&#34;background-color:skyblue;text-align:center&#34;&gt;&lt;b&gt;Stop mitigation while others are running&lt;/b&gt;&lt;/p&gt;



---
## Outro

Well I hope this post was interesting enough and can be used as a reference while exploring the  use cases covered:
- How to leverage Kentik EDA to receive Portal notifications and execute ansible playbooks 
- How to use telegraf to send custom ST metrics to Kentik NMS
- Generating telegraf configuration dynamically 

&lt;p align=&#34;right&#34;&gt;&lt;br&gt;&lt;br&gt;&lt;i&gt;...till next time...have fun!!! &lt;/i&gt; &lt;/p&gt;

---
## Influences and Reference

- [Driving Network Automation Innovation: Kentik and Red Hat Launch Integration](https://www.kentik.com/blog/driving-network-automation-innovation-kentik-and-red-hat-launch-integration/)
- [EDA Quickstart](https://www.ansible.com/blog/getting-started-with-event-driven-ansible/)
- [Using Telegraf to Feed API JSON Data into Kentik NMS](https://www.kentik.com/blog/using-telegraf-to-feed-api-json-data-into-kentik-nms/)
- [Kentik&#39;s ansible_eda](https://github.com/kentik/ansible_eda)
- [Repo for this post](https://github.com/becos76/kentik-eda)

---

---

> Author:    
> URL: https://net4fungr.github.io/posts/modern-nms/  

