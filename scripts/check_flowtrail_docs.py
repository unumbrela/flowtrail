"""Check local file links in FlowTrail-owned Markdown documentation."""

import re
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
FILES = [
    ROOT / name
    for name in (
        "README.md",
        "README.en.md",
        "CONTRIBUTING.md",
        "SECURITY.md",
        "UPSTREAM.md",
        "docs/wenjuanxing.md",
    )
]
FILES += sorted((ROOT / "docs/flowtrail").glob("*.md"))
FILES += sorted((ROOT / "docs/portfolio").glob("*.md"))


def main() -> None:
    """Fail on broken relative file links; external links and anchors are skipped."""
    broken = []
    checked = 0
    for document in FILES:
        for target in re.findall(r"\]\(([^)]+)\)", document.read_text()):
            parsed = urlsplit(target)
            if parsed.scheme or parsed.netloc or not parsed.path:
                continue
            checked += 1
            if not (document.parent / unquote(parsed.path)).exists():
                broken.append(f"{document.relative_to(ROOT)}: {target}")
    if broken:
        raise SystemExit("Broken local links:\n" + "\n".join(broken))
    print(f"Checked {checked} local file links in {len(FILES)} FlowTrail documents.")


if __name__ == "__main__":
    main()
