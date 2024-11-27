---
title: For those about to LAB...⚡ 
subtitle: or should I say, Cisco IOU, I am still in love with you
date: 2024-11-05T00:00:00Z
lastmod: 2024-11-05T00:00:00Z
draft: true
tags:
  - netsim
  - netlab
  - containerlab
  - automation
categories:
  - Netsim
toc:
  enable: true
code:
  copy: true
  maxShownLines: 30
author: " "
summary: Showcase how to use Cisco IOL in your containerlabs using netlab to orchestrate the provisioning of the infra and Kentik for the traffic visibility and monitoring use cases.
---
---
## Intro


Cisco IOU and I go back a long time - explaing ccie lab

netlab - automate the boring stuff - conf t, no ip do lo - line con 0, logg sync


## Use Case Brief


## Things Covered


## Setting Things Up

- Install netlab
- Build IOL
- Testing it



### Components

- NMS agent as docker container


### Customizations

- Need a site, or sites created in the portal with their IDs referenced in the topo
- Need a plan or plans created in the portal, referenced in topo
- Need an NMS agent ID






## Outro


- netlab config iperf3_run -v -C -l clients
- flexible netflow - no go cause cannot control cache active/inactive timeouts

- ksynth in groups in topo
- bgp adv communities per rc (only for kentik or in general)
- vrfs please