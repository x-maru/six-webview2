#!/bin/bash

VERSION=09

rm -f six_v${VERSION}.tar ; tar cf six_v${VERSION}.tar --transform="s,^,six_v${VERSION}/," \
six.ps1 \
_six.js \
_six.html \
_six.css \
_six.cs \
_six.customize \
1024x1024.png \
512x512.png \
256x256.png \
six_shortcut.ico \
install.cmd
