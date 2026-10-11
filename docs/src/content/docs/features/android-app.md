---
title: Android App
description: A native Android app for your server that works without Google Play Services.
sidebar:
  order: 18
---

There is a native Android app that opens your own server. It shows the same pages as the web version, adapted to the phone, and it does not use Google Play Services, so it runs on GrapheneOS and other de-Googled phones.

The app lives in its own repository, [anvveber/hyperion_mobile](https://github.com/anvveber/hyperion_mobile). Download the `.apk` from its [Releases page](https://github.com/anvveber/hyperion_mobile/releases) on your phone and open it to install. On first launch it asks for your server address, then shows the normal login page. The repository's README covers installing, updating, notifications and building the app yourself.

## Technical details

- The app adds `HyperionAndroid/<version>` to its user agent. The web app treats that as an installed app and hides its "install app" prompt.
