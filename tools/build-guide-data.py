#!/usr/bin/env python3
"""Convert the supplied book into section-sized lessons, preserving displayed math."""
import argparse
import contextlib
import io
import json
import re
from pathlib import Path

import pymupdf
import pymupdf4llm

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'guide-assets'
CACHE = ROOT / '.build-cache'


def compact(text):
    return re.sub(r'\s+', ' ', text.replace('\xad', '').replace('\ufeff', '')).strip()


def slug(text):
    return re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')


def lines(page):
    result = []
    for block in page.get_text('dict')['blocks']:
        for line in block.get('lines', []):
            spans = line['spans']
            result.append({
                'text': compact(''.join(s['text'] for s in spans)),
                'bbox': line['bbox'],
                'size': max(s['size'] for s in spans),
                'heading': any('MyriadPro-Semibold' in s['font'] for s in spans),
            })
    return result


def find_sections(doc):
    sections = []
    chapter = 'Front matter'
    chapter_number = None
    front = {'Preface', 'Acronyms', 'Nomenclature'}
    extras = {'Questions', 'Problems', 'Design Questions', 'Design Projects',
              'Design Problems', 'Laboratory Experiments'}
    for page_index, page in enumerate(doc):
        rows = lines(page)
        major = [r for r in rows if r['heading'] and r['size'] >= 12.9]
        number = next((r['text'] for r in major if re.fullmatch(r'\d{1,2}', r['text'])), None)
        chapter_row = next((r for r in major if len(r['text']) > 3), None)
        if number and chapter_row and 1 <= int(number) <= 14:
            chapter_number = number
            chapter = f'{number}. {chapter_row["text"]}'
            sections.append(dict(title=chapter_row['text'], group=chapter, page=page_index,
                                 y=65, kind='overview', number=number))
        for ri, row in enumerate(rows):
            text = row['text']
            if not row['heading'] or row['size'] < 12.3 or row['bbox'][1] < 65:
                continue
            if text in front and page_index < 33:
                sections.append(dict(title=text, group='Front matter', page=page_index,
                                     y=row['bbox'][1]-2, kind='reference'))
            elif text in {'References', 'Index'} and page_index > 600:
                sections.append(dict(title=text, group='Reference', page=page_index,
                                     y=row['bbox'][1]-2, kind='reference'))
            elif chapter_number and (re.match(r'^\d{1,2}\.\d+\s', text) or text in extras):
                # Some long section titles wrap onto the next line.
                if ri + 1 < len(rows):
                    nxt = rows[ri+1]
                    if (nxt['heading'] and 12.3 <= nxt['size'] < 12.9
                            and 0 <= nxt['bbox'][1] - row['bbox'][3] < 8
                            and not re.match(r'^\d', nxt['text'])):
                        text += ' ' + nxt['text']
                sections.append(dict(title=text, group=chapter, page=page_index,
                                     y=row['bbox'][1]-2, kind='section'))
    sections.sort(key=lambda s: (s['page'], s['y']))
    # The companion-site advertisement is outside the study material.
    for i, section in enumerate(sections):
        section['id'] = slug(section['group'] + '-' + section['title'])
        section['end'] = sections[i+1] if i+1 < len(sections) else {'page': len(doc)-1, 'y':650}
    return sections


def protect_equations(page):
    rows = [r for r in lines(page) if 65 <= r['bbox'][1] < 650]
    seeds = [r for r in rows if re.search(r'\(\d{1,2}\.\d+[a-z]?\)\s*$', r['text'])
             and r['bbox'][2] > 390
             and len(re.findall(r'[A-Za-z]{3,}', r['text'])) < 7]
    barriers = [r for r in rows if (r['heading'] and r['size'] >= 10)
                or len(re.findall(r'[A-Za-z]{3,}', r['text'])) >= 7]
    regions = []
    for seed in seeds:
        y0, y1 = seed['bbox'][1], seed['bbox'][3]
        above = [r['bbox'][3] for r in barriers if r['bbox'][3] < y0]
        below = [r['bbox'][1] for r in barriers if r['bbox'][1] > y1]
        top = max(above, default=66) + 1
        bottom = min(below, default=650) - 1
        # Short paragraph tails can overlap the preceding line's font box.
        # Keep them as text instead of clipping them into the equation image.
        for _ in range(12):
            old = (top, bottom)
            for row in rows:
                if row['bbox'][0] >= 80 or not re.search(r'[A-Za-z]{4,}', row['text']):
                    continue
                if row['bbox'][1] < top < row['bbox'][3]:
                    top = row['bbox'][3] + 1
                if row['bbox'][1] < bottom < row['bbox'][3]:
                    bottom = row['bbox'][1] - 1
            if old == (top, bottom):
                break
        if bottom <= top:
            continue
        if regions and top <= regions[-1][1]:
            regions[-1] = (regions[-1][0], max(bottom, regions[-1][1]))
        else:
            regions.append((top, bottom))
    snapshots = []
    for top, bottom in regions:
        rect = pymupdf.Rect(45, top, 450, bottom)
        snapshots.append((rect, page.get_pixmap(matrix=pymupdf.Matrix(2.5, 2.5), clip=rect).tobytes('png')))
        page.add_redact_annot(rect, fill=(1,1,1))
    if snapshots:
        page.apply_redactions(images=2, graphics=1, text=0)
        for rect, data in snapshots:
            page.insert_image(rect, stream=data)
    return len(snapshots)


def protect_diagrams(page):
    """Keep imported drawing labels together with their lines and arrows."""
    labels = []
    for block in page.get_text('dict')['blocks']:
        for line in block.get('lines', []):
            if any(re.match(r'(Times|Helvetica|Arial)', s['font']) for s in line['spans']):
                if line['bbox'][1] >= 65:
                    labels.append(pymupdf.Rect(line['bbox']))
    drawings = [r for r in page.cluster_drawings() if r.height > 20 and r.width > 35]
    regions = []
    for drawing in drawings:
        rect = pymupdf.Rect(drawing)
        found = False
        for _ in range(3):
            for label in labels:
                if label.y1 >= rect.y0-16 and label.y0 <= rect.y1+16:
                    rect |= label
                    found = True
        if found and rect.y0 >= 65 and rect.y1 <= 650:
            regions.append((rect.y0-2, rect.y1+2))
    merged = []
    for top, bottom in sorted(regions):
        if merged and top <= merged[-1][1]+3:
            merged[-1] = (merged[-1][0], max(merged[-1][1], bottom))
        else:
            merged.append((top, bottom))
    snapshots = []
    for top, bottom in merged:
        rect = pymupdf.Rect(45, top, 450, bottom)
        snapshots.append((rect, page.get_pixmap(matrix=pymupdf.Matrix(2.5,2.5), clip=rect).tobytes('png')))
        page.add_redact_annot(rect, fill=(1,1,1))
    if snapshots:
        page.apply_redactions(images=2, graphics=1, text=0)
        for rect, data in snapshots:
            page.insert_image(rect, stream=data)
    return len(snapshots)


def header(span, page=None):
    if 'MyriadPro-Semibold' not in span['font']:
        return ''
    text = compact(span['text'])
    if span['size'] >= 12.3 and not re.fullmatch(r'\d+', text):
        return '# '
    if span['size'] >= 10.0 and re.match(r'^\d+\.\d+\.', text):
        return '## '
    return ''


def clean_markdown(text, section):
    text = text.replace('\xad', '').replace('\u00a0', ' ')
    text = text.replace(str(ASSETS) + '/', 'guide-assets/')
    text = re.sub(r'(?<=\w)[‐-]\n(?=[a-z])', '', text)
    text = re.sub(r'^-----\s*$', '', text, flags=re.M)
    text = re.sub(r'^\*\*==>.*?omitted.*?\*\*$', '', text, flags=re.M)
    text = re.sub(r'^(?:_?Design of Unmanned Aerial Systems.*First Edition.*|© 2020.*|Companion website:.*)$', '', text, flags=re.M)
    text = re.sub(r'^(\d+)\)\s+', r'\1. ', text, flags=re.M)
    # Keep the lesson title in its header, with subsection headings in the body.
    rows = text.splitlines()
    while rows and not rows[0].strip():
        rows.pop(0)
    if rows and compact(re.sub(r'[*#_]', '', rows[0])) == section['title']:
        rows.pop(0)
    text = '\n'.join(rows)
    if section['kind'] == 'overview':
        match = re.search(r'^(?:#+\s*)?(?:\*\*)?Educational Outcomes(?:\*\*)?\s*$', text, flags=re.M)
        if match:
            text = text[match.start():]
    return re.sub(r'\n{3,}', '\n\n', text).strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('pdf', nargs='?', type=Path, default=ROOT/'book.pdf')
    parser.add_argument('--limit', type=int)
    parser.add_argument('--rebuild', action='store_true', help='Ignore completed lesson caches.')
    args = parser.parse_args()
    ASSETS.mkdir(exist_ok=True)
    CACHE.mkdir(exist_ok=True)
    pymupdf4llm.use_layout(False)
    doc = pymupdf.open(args.pdf)
    sections = find_sections(doc)
    (CACHE/'sections.json').write_text(json.dumps([{k:v for k,v in s.items() if k!='end'} for s in sections], indent=2))
    print(f'Found {len(sections)} sections in {len(doc)} pages.', flush=True)
    protected = 0
    diagrams = 0
    for n in range(33, len(doc)):
        diagrams += protect_diagrams(doc[n])
        protected += protect_equations(doc[n])
    print(f'Preserved {protected} equation regions and {diagrams} diagrams.', flush=True)
    lessons = []
    for n, section in enumerate(sections[:args.limit] if args.limit else sections):
        cache_path = CACHE/f'lesson-{n+1:03}.json'
        if cache_path.exists() and not args.rebuild:
            lessons.append(json.loads(cache_path.read_text()))
            continue
        end = section['end']
        # Stop nomenclature before the companion-site advertisement.
        if section['title'] == 'Nomenclature':
            end = {'page':32, 'y':65}
        last_page = end['page'] if end['y'] > 65 else end['page']-1
        part = pymupdf.open()
        for pi in range(section['page'], last_page+1):
            top = section['y'] if pi == section['page'] else 65
            bottom = end['y'] if pi == end['page'] else 650
            if bottom-top < 3:
                continue
            rect = pymupdf.Rect(0, top, doc[pi].rect.width, bottom)
            target = part.new_page(width=rect.width, height=rect.height)
            target.show_pdf_page(target.rect, doc, pi, clip=rect)
        path = CACHE/f'lesson-{n+1:03}.pdf'
        part.save(path)
        part.close()
        with contextlib.redirect_stdout(io.StringIO()):
            md = pymupdf4llm.to_markdown(str(path), hdr_info=header, write_images=True,
                 image_path=str(ASSETS), image_size_limit=0, dpi=160,
                 force_text=False, margins=0, show_progress=False)
        lesson = {
            'id':section['id'], 'title':section['title'], 'group':section['group'],
            'kind':section['kind'], 'pdfPage':section['page']+1, 'pdfEndPage':last_page+1,
            'markdown':clean_markdown(md, section),
        }
        if not lesson['markdown']:
            raise RuntimeError(f'Empty section: {section["title"]}')
        cache_path.write_text(json.dumps(lesson,ensure_ascii=False))
        path.unlink()
        lessons.append(lesson)
        print(f'{n+1}/{len(sections)}: {section["title"]}', flush=True)
    used = set()
    for lesson in lessons:
        used.update(re.findall(r'!\[[^\]]*\]\(([^)]+)\)', lesson['markdown']))
    image_sizes = {}
    for name in sorted(used):
        pix = pymupdf.Pixmap(ROOT/name)
        image_sizes[name] = [pix.width, pix.height]
    if not args.limit:
        for image in ASSETS.glob('*.png'):
            if image.relative_to(ROOT).as_posix() not in used:
                image.unlink()
    payload = {
        'title':'Design of Unmanned Aerial Systems', 'author':'Mohammad H. Sadraey',
        'lessonCount':len(lessons), 'chapterCount':14, 'sourcePages':len(doc),
        'equationRegions':protected, 'diagramRegions':diagrams,
        'imageSizes':image_sizes, 'lessons':lessons,
    }
    (ROOT/'guide-data.js').write_text('window.GUIDE_DATA = '+json.dumps(payload,ensure_ascii=False)+';\n')
    print(f'Built {len(lessons)} lessons with {len(used)} image references.', flush=True)


if __name__ == '__main__':
    main()
