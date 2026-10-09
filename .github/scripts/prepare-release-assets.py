#!/usr/bin/env python3
"""Flatten current-run installer artifacts without filename collisions."""
import hashlib
import shutil
import sys
from pathlib import Path


def prepare(source, destination):
    source, destination = Path(source), Path(destination)
    groups = sorted(path for path in source.iterdir() if path.is_dir())
    if not groups:
        raise ValueError('No installer artifacts downloaded')
    if destination.exists() and any(destination.iterdir()):
        raise ValueError('Release output must be empty')
    destination.mkdir(parents=True, exist_ok=True)
    assets = []
    for group in groups:
        files = sorted(path for path in group.rglob('*') if path.is_file())
        if not files:
            raise ValueError(f'Empty artifact: {group.name}')
        for path in files:
            if path.is_symlink() or path.suffix.lower() not in ('.deb', '.appimage', '.exe', '.dmg'):
                raise ValueError(f'Unexpected installer: {path}')
            target = destination / f'{group.name}--{path.name}'
            if target.exists():
                raise ValueError(f'Duplicate asset: {target.name}')
            shutil.copyfile(path, target)
            assets.append(target)
    checksums = ''.join(f'{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n' for path in assets)
    (destination / 'SHA256SUMS').write_text(checksums)
    return assets


if __name__ == '__main__':
    try:
        print(f'Prepared {len(prepare(*sys.argv[1:]))} installers with SHA256SUMS')
    except (ValueError, OSError, TypeError) as error:
        raise SystemExit(str(error)) from error
