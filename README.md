# http-tunnel

Initializes a tunnel to a local webserver through a public hosted server.

If you are on the road, behind fifteen firewalls, and want to share some webapp you're developing locally, or just share a set of files with someone quickly, this tool will do the job.

It is capable of either forwarding incoming connections to a locally running webapp, or serve the current working directory (with an optional directory listing as well, if you don't have an index file).

## Testing through public server

`./http-tunnel.js --server pub.2x.io -d -s`

This will serve the current directory (the -s argument), along with a directory index (the -d argument).

`./http-tunnel.js --server pub.2x.io -d -s -i myhost`

This will serve the current directory (the -s argument), along with a directory index (the -d argument), and also attempt to host it at the myhost prefix. In case of the example, that would be myhost.pub.2x.io, should that be currently available.

## Custom server

This can be hosted on any server, but really ought to be one with a wildcard dns pointed to it. In case of the testserver above, it is running HAProxy with an SSL terminator in front. If you're curious about the HAProxy config, leave an issue or drop me an email.
