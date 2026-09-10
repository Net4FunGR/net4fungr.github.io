# Proxy or Not...here I Come...


There has been a need sometimes that you are on a system that is not permanently set to use a proxy server for internet access and you just want to give one or two curl or wget commands to fetch some files, or vice versa :smile:. In order to avoid exporting the appropriate environment variables in the correct place, you can use the following two methods to enable or disable ad-hoc usage of the proxy server in linux bash.

## Method One - as an executable preceding your actual command
Just put the following commands in a bash script, make it executable and put it in your path somewhere on the system.
```bash
becos@fossa:~$ cat proxy
#!/bin/bash -eu

###########
## Adjust to your environment
##
HTTP_PROXY="http://10.10.10.10:8080"
HTTPS_PROXY="http://10.10.10.10:8080"
NO_PROXY="localhost,127.0.0.1,$(hostname -i),.domain.com"
###########
http_proxy="$HTTP_PROXY"
https_proxy="$HTTPS_PROXY"
no_proxy="$NO_PROXY"

export HTTP_PROXY HTTPS_PROXY NO_PROXY http_proxy https_proxy no_proxy
exec "$@"

becos@fossa:~$ chmod +x proxy && sudo mv !$ /usr/local/bin/
chmod +x proxy && sudo mv proxy /usr/local/bin/
```
Now you can precede the __proxy__ command just before calling your command that needs the proxy environment variables.
```bash
becos@fossa:~$ proxy curl -sv http://www.google.com > /dev/null
* Uses proxy env variable no_proxy == 'localhost,127.0.0.1,192.168.1.5,.domain.com'
* Uses proxy env variable http_proxy == 'http://10.10.10.10:8080'
*   Trying 10.10.10.10:8080...
* TCP_NODELAY set
^C
becos@fossa:~$
```
## Method Two - as functions to the user profile
You can add these two functions in say your _.profile_

```bash
function proxyoff
{
        unset http_proxy HTTP_PROXY https_proxy HTTPS_PROXY no_proxy NO_PROXY
}
function proxyon
{
        http_proxy="http://10.10.10.10:8080"
        HTTP_PROXY="$http_proxy"
        https_proxy="http://10.10.10.10:8080"
        HTTPS_PROXY="$http_proxy"
        no_proxy="localhost,127.0.0.1,$(hostname -i),.domain.com"
        NO_PROXY="$no_proxy"
        export http_proxy HTTP_PROXY https_proxy HTTPS_PROXY no_proxy NO_PROXY
}
```
So, after a new shell, you can use the on and off functions according to your intent.

```bash
becos@fossa:~$ env | grep -i proxy

becos@fossa:~$ proxyon

becos@fossa:~$ env | grep -i proxy
no_proxy=localhost,127.0.0.1,192.168.1.5,.domain.com
https_proxy=http://10.10.10.10:8080
NO_PROXY=localhost,127.0.0.1,192.168.1.5,.domain.com
HTTPS_PROXY=http://10.10.10.10:8080
HTTP_PROXY=http://10.10.10.10:8080
http_proxy=http://10.10.10.10:8080

becos@fossa:~$ proxyoff

becos@fossa:~$ env | grep -i proxy

```
That's it, I hope it finds a use case.


<p align="right">...till next time...<em>have fun!</em></p>

---

> Author:    
> URL: https://net4fungr.github.io/posts/proxy-or-not/  

