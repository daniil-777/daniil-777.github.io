"""Check every rendered text node and accessible label against the source catalog.

Run after `npm run build`. Uses only Python's standard library.
"""
from html.parser import HTMLParser
from pathlib import Path
import json
import re
import sys

ROOT = Path(__file__).resolve().parent.parent
SOURCES = json.loads((ROOT / 'src/i18n/locales/en.json').read_text())
NATIVE = {'English', 'Deutsch', 'Français', 'Italiano', 'Español', '简体中文', 'Русский', 'EN'}
SKIP = {'script', 'style', 'svg', 'pre', 'code'}


class Inventory(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack = []
        self.strings = set()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        ignored = tag in SKIP or 'data-no-translate' in attrs or attrs.get('translate') == 'no'
        self.stack.append((tag, ignored))
        if not any(item[1] for item in self.stack):
            for key in ('aria-label', 'aria-description', 'aria-valuetext', 'title', 'alt', 'placeholder'):
                if attrs.get(key):
                    self.add(attrs[key])
            if tag == 'meta' and (attrs.get('name') == 'description' or attrs.get('property') in ('og:title', 'og:description')):
                self.add(attrs.get('content', ''))
        if tag in {'meta', 'img', 'input', 'link', 'source', 'br', 'hr', 'wbr'}:
            self.stack.pop()

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break

    def handle_data(self, text):
        if not any(item[1] for item in self.stack):
            self.add(text)

    def add(self, text):
        text = re.sub(r'\s+', ' ', text).strip()
        if re.search(r'[a-zA-Z]{2}', text) and text not in NATIVE:
            self.strings.add(text)


missing = {}
pages = list((ROOT / 'build').glob('**/*.html'))
for page in pages:
    parser = Inventory()
    parser.feed(page.read_text())
    for text in parser.strings:
        if text not in SOURCES:
            missing.setdefault(text, []).append(str(page.relative_to(ROOT / 'build')))

for text, paths in missing.items():
    print(f'Missing source copy: {text}\n  {", ".join(paths[:3])}')
if missing:
    sys.exit(1)
print(f'Localization coverage passed: {len(pages)} HTML pages, {len(SOURCES)} source strings.')
