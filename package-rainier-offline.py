"""Make the rendered standalone export portable without network resources."""
from pathlib import Path
import html
import json
import re

base = Path(__file__).parent
source = base / 'rainier-earthquakes-portable.html'
output = base / 'rainier-earthquakes-offline.html'
libraries = {
    'https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js': 'd3-7.9.0.min.js',
    'https://cdn.jsdelivr.net/npm/plotly.js-dist-min@3.1.0/plotly.min.js': 'plotly-3.1.0.min.js',
    'https://unpkg.com/@floating-ui/core@1.7.3/dist/floating-ui.core.umd.min.js': 'floating-ui-core-1.7.3.min.js',
    'https://unpkg.com/@floating-ui/dom@1.7.4/dist/floating-ui.dom.umd.min.js': 'floating-ui-dom-1.7.4.min.js',
    'https://unpkg.com/lucide@1.17.0/dist/umd/lucide.js': 'lucide-1.17.0.js',
}
document = source.read_text(encoding='utf-8')
match = re.search(r'data-srcdoc="([^"]*)"', document)
assert match, 'Standalone iframe not found'
inner = html.unescape(match.group(1))
used = []

def inline_script(match):
    attributes, url, trailing = match.group(1), match.group(2), match.group(3)
    assert url in libraries, f'Unexpected external script: {url}'
    library = (base / libraries[url]).read_text(encoding='utf-8-sig')
    assert len(library) > 1000 and not library.lstrip().lower().startswith('<html'), url
    # Avoid closing the containing script when a library contains an HTML string.
    library = re.sub(r'</script', lambda _: r'<\/script', library, flags=re.I)
    attributes = re.sub(r'\sasync\b', '', attributes + trailing)
    used.append(url)
    return f'<script{attributes}>\n{library}\n</script>'

inner = re.sub(r'<script([^>]*?)\ssrc="([^"]+)"([^>]*)>\s*</script>', inline_script, inner)
assert set(used) == set(libraries), used
assert not re.search(r'<(?:script|link)[^>]+(?:src|href)="https?://', inner)

def restrict_csp(markup):
    def replace(match):
        # No network is permitted or needed by this offline copy.
        policy = re.sub(r'\shttps://[^\s;]+', '', match.group(2))
        return match.group(1) + policy + match.group(3)
    return re.sub(r'(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(">)', replace, markup)

inner = restrict_csp(inner)
document = document[:match.start(1)] + html.escape(inner, quote=True) + document[match.end(1):]
document = restrict_csp(document)
output.write_text(document, encoding='utf-8')
print(json.dumps({'output': str(output), 'bytes': output.stat().st_size, 'embedded_libraries': len(used)}))
