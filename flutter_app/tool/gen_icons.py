# -*- coding: utf-8 -*-
"""Launcher icon and splash mark, resized from the design assets.

    python tool/gen_icons.py

No generator package. This is four images resized into five densities each,
and a package that did it would still need these numbers written down
somewhere — so they are written down here, next to what they mean.

Sources are `assets/images/`, shared with the React Native app: the same icon
should survive the rewrite, and pointing at the same files is how it stays that
way rather than how it drifts.
"""
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.normpath(os.path.join(HERE, '..', '..', 'assets', 'images'))
RES = os.path.normpath(
    os.path.join(HERE, '..', 'android', 'app', 'src', 'main', 'res'))

# Android's five buckets, as multiples of mdpi.
DENSITY = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}

# What goes where, in dp.
#
# 48 is the legacy launcher icon, used below API 26. 108 is the adaptive icon
# layer: the outer 18dp on each side is bleed the launcher may crop, mask or
# animate, which is why the foreground art has its own padding built in. 140
# is the splash mark, matching the imageWidth the Expo build asked for so the
# app opens the same size it used to.
JOBS = [
    ('icon.png', 'mipmap', 'ic_launcher.png', 48),
    ('android-icon-foreground.png', 'mipmap', 'ic_launcher_foreground.png', 108),
    ('android-icon-monochrome.png', 'mipmap', 'ic_launcher_monochrome.png', 108),
    ('splash-icon.png', 'drawable', 'splash.png', 140),
]


def main():
    for src, folder, name, dp in JOBS:
        img = Image.open(os.path.join(ASSETS, src)).convert('RGBA')
        for bucket, scale in DENSITY.items():
            px = int(round(dp * scale))
            dest = os.path.join(RES, '{}-{}'.format(folder, bucket))
            os.makedirs(dest, exist_ok=True)
            img.resize((px, px), Image.LANCZOS).save(os.path.join(dest, name))
        print('{:<32} {}dp'.format(name, dp))


if __name__ == '__main__':
    main()
