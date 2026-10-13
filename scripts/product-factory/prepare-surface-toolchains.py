#!/usr/bin/env python3
"""Provision offline surface images from reviewed local toolchains, never product code.

Requires an existing Node builder context and checksum-verified SDK archives.
Does not download, change host configuration, accept licenses or widen product network.
"""
import argparse
import pathlib
import re
import shutil
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--base-context', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--mode', choices=['browser', 'android'], required=True)
parser.add_argument('--sdk-root')
parser.add_argument('--jdk', default='/usr/lib/jvm/java-21-openjdk-amd64')
parser.add_argument('--playwright', default='/opt/codex/runtimes/cua/lib/node_modules/playwright-core')
parser.add_argument('--docker-config', required=True)
args = parser.parse_args()
root = pathlib.Path(args.output).resolve()
base = pathlib.Path(args.base_context).resolve()
if root == base or root.exists():
    raise SystemExit('Use a new output directory; preserve existing toolchains')
shutil.copytree(base, root)
if args.mode == 'browser':
    copies = [('/usr/lib/chromium', 'usr/lib/chromium'),
              ('/usr/share/fonts/truetype/dejavu', 'usr/share/fonts/truetype/dejavu'),
              (args.playwright, 'toolchain/playwright-core')]
else:
    if not args.sdk_root:
        raise SystemExit('Reviewed SDK root required')
    sdk = pathlib.Path(args.sdk_root)
    copies = [(args.jdk, 'usr/lib/jvm'), (sdk/'platform/android-35', 'sdk/platform'),
              (sdk/'build-tools/android-15', 'sdk/build-tools')]
for source, destination in copies:
    shutil.copytree(source, root/destination, dirs_exist_ok=True, symlinks=False)
if args.mode == 'android':
    shutil.copy2(pathlib.Path(__file__).with_name('android-build.cjs'), root/'toolchain/android-build.cjs')
for _, destination in copies:
    # Only inspect installed executable/library files, not generated code.
    for file in (root/destination).rglob('*'):
        if not file.is_file() or file.stat().st_size > 100_000_000:
            continue
        with file.open('rb') as handle:
            if handle.read(4) != b'\x7fELF':
                continue
        try:
            linked = subprocess.check_output(['ldd', str(file)], text=True, stderr=subprocess.DEVNULL)
        except subprocess.CalledProcessError:
            continue
        for item in re.findall(r'(/[^\s()]+)', linked):
            source = pathlib.Path(item)
            if source.is_file():
                target = root/str(source).lstrip('/')
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
(root/'Dockerfile').write_text('FROM scratch\nCOPY --chmod=755 . /\nUSER 10000:10000\nWORKDIR /work\nENTRYPOINT ["/usr/local/bin/node"]\n')
subprocess.run(['docker', '--config', args.docker_config, 'build', '--network', 'none',
                '--pull=false', '-t', f'automaton-{args.mode}-builder:local', str(root)], check=True)
