## In brief

If you are on the road, behind fifteen firewalls, and want to share some web application you're developing locally, or just share a set of files with someone real quick; this tool will do the job!

`http-tunnel` will either forwarding incoming connections to a locally running webapp, or serve the current working directory (with an optional directory listing as well, if you don't have an index file) through an adhoc express instance.

And yes, it supports WebSockets.

## Installation and usage

### Install? Easy!

`$ npm install -g http-tunnel`

### Share a folder as a website?

```
$ mkdir somefolder
$ cd somefolder
$ echo hi > file.txt
$ http-tunnel --server pub.2x.io -d -s
```

This will create a tunnel through a public url, such as `http://foofy.pub.2x.io` and serve the content of the `somefolder` directory (the `-s` argument), along with a directory index (`-d`).

And if you want to use a custom hostname, try `-i foobar`, or anything else to your liking. That would e.g. result in `http://foobar.pub.2x.io`. If the name is currently available, it'll be serving you.

### To serve a locally running web application?

```
$ http-tunnel --server pub.2x.io -p 8080
```

This will create a tunnel through a public url, such as `http://foofy.pub.2x.io` and proxy requests to and from port 8080 (the `-p` argument).

## Note

The demonstration server, `pub.2x.io`, is at the moment rate limited. Should you wish a higher bandwidth permanent solution, get in touch with me for pointers.

## Hosting on a custom server

This can be hosted on any server, but really ought to be one with a wildcard dns pointed to it. In case of the testserver above, it is running HAProxy with an SSL terminator in front. If you're curious about the HAProxy config, leave an issue or drop me an email.