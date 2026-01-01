#!/usr/bin/env python3

import argparse
import os
import re
import stat
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Dict, Iterator, List, Tuple


SKILL_NAME_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")


def parse_frontmatter(skill_md_path: Path) -> Dict[str, str]:
    text = skill_md_path.read_text(encoding="utf-8")
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        raise ValueError("SKILL.md must start with a YAML frontmatter block ('---').")

    end_index = None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end_index = i
            break
    if end_index is None:
        raise ValueError("SKILL.md YAML frontmatter must be terminated by a second '---' line.")

    fm_lines = lines[1:end_index]
    out: Dict[str, str] = {}

    i = 0
    while i < len(fm_lines):
        raw = fm_lines[i]
        line = raw.strip()
        i += 1

        if not line or line.startswith("#"):
            continue
        if ":" not in raw:
            continue

        key, rest = raw.split(":", 1)
        key = key.strip()
        value = rest.strip()

        if value in ("|", ">"):
            block: List[str] = []
            while i < len(fm_lines) and (fm_lines[i].startswith(" ") or fm_lines[i].startswith("\t")):
                block.append(fm_lines[i].lstrip())
                i += 1
            value = "\n".join(block).rstrip()
        else:
            if (
                (value.startswith('"') and value.endswith('"') and len(value) >= 2)
                or (value.startswith("'") and value.endswith("'") and len(value) >= 2)
            ):
                value = value[1:-1]

        if key:
            out[key] = value

    return out


def validate_skill_dir(skill_dir: Path) -> Tuple[str, str]:
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.exists():
        raise ValueError(f"Missing required file: {skill_md}")

    fm = parse_frontmatter(skill_md)
    name = (fm.get("name") or "").strip()
    description = (fm.get("description") or "").strip()

    if not name:
        raise ValueError("SKILL.md frontmatter must include a non-empty 'name'.")
    if not description:
        raise ValueError("SKILL.md frontmatter must include a non-empty 'description'.")

    if not SKILL_NAME_RE.match(name):
        raise ValueError(
            "SKILL.md 'name' must use lowercase letters, digits, and hyphens only (max 64 chars)."
        )

    if skill_dir.name != name:
        raise ValueError(
            f"Skill folder name must match SKILL.md 'name' ({skill_dir.name!r} != {name!r})."
        )

    return name, description


def iter_skill_files(skill_dir: Path) -> Iterator[Tuple[Path, Path]]:
    excluded_names = {".DS_Store", "Thumbs.db"}
    for p in sorted(skill_dir.rglob("*")):
        if p.is_dir():
            continue
        rel = p.relative_to(skill_dir)
        if any(part in excluded_names for part in rel.parts):
            continue
        yield p, rel


def make_zipinfo(arcname: str, mode: int) -> zipfile.ZipInfo:
    zi = zipfile.ZipInfo(arcname)
    zi.date_time = (1980, 1, 1, 0, 0, 0)
    zi.external_attr = (stat.S_IMODE(mode) & 0o777) << 16
    zi.compress_type = zipfile.ZIP_DEFLATED
    return zi


def package_skill(skill_dir: Path, out_dir: Path) -> Path:
    validate_skill_dir(skill_dir)

    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{skill_dir.name}.skill"

    with tempfile.NamedTemporaryFile(prefix=f"{skill_dir.name}-", suffix=".skill.tmp", dir=out_dir, delete=False) as tmp:
        tmp_path = Path(tmp.name)

    try:
        with zipfile.ZipFile(tmp_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for src_path, rel in iter_skill_files(skill_dir):
                arc = f"{skill_dir.name}/{rel.as_posix()}"
                data = src_path.read_bytes()
                zi = make_zipinfo(arc, src_path.stat().st_mode)
                zf.writestr(zi, data)

        os.replace(tmp_path, out_path)
        try:
            out_path.chmod(0o644)
        except Exception:
            pass
        return out_path
    finally:
        try:
            if tmp_path.exists():
                tmp_path.unlink()
        except Exception:
            pass


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(description="Validate and package a Codex skill into a .skill zip artifact.")
    parser.add_argument("skill_dir", help="Path to the skill folder (must contain SKILL.md).")
    parser.add_argument(
        "out_dir",
        nargs="?",
        default=".",
        help="Output directory for the .skill artifact (default: current directory).",
    )
    args = parser.parse_args(argv)

    skill_dir = Path(args.skill_dir).resolve()
    out_dir = Path(args.out_dir).resolve()

    if not skill_dir.exists() or not skill_dir.is_dir():
        raise SystemExit(f"Skill dir not found: {skill_dir}")

    out_path = package_skill(skill_dir, out_dir)
    sys.stdout.write(f"{out_path}\n")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except Exception as e:
        sys.stderr.write(f"Error: {e}\n")
        raise SystemExit(1)
