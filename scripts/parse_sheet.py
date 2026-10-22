import csv, io, json, re, sys
src = open('data/sheet_export.txt', encoding='utf-8').read().splitlines()  # run from repo root
sections, cur = {}, None
for ln in src:
    if ln.startswith('## Sheet name: '):
        cur = ln[len('## Sheet name: '):].strip(); sections[cur] = []
    elif cur is not None:
        sections[cur].append(ln)

def rows(name):
    return list(csv.reader(io.StringIO('\n'.join(sections[name]))))

ALIAS = {'Brendan D': 'Brendan', 'G.A.': 'Geoff', 'B.Patnode': 'BP'}
norm = lambda n: ALIAS.get(n.strip(), n.strip())

# champions: sheet labels a season by the year it ends (2005 = 2004-05)
champ = {}
for r in rows('Reg/Tournament Champs'):
    if r and re.fullmatch(r'\d{4}', r[0].strip()) and len(r) >= 7 and r[1].strip():
        y = int(r[0])
        champ[y] = {'reg': [norm(x) for x in r[1:4]], 'tourney': [norm(x) for x in r[4:7]]}

seasons = {}
for r in rows('Raw'):
    if len(r) >= 7 and re.fullmatch(r'\d{4}-\d{2}', r[1].strip()):
        label = r[1].strip(); start = int(label[:4]); end = start + 1
        t = {'owner': norm(r[0]), 'team': r[2].strip(), 'w': int(r[3]), 'l': int(r[4]), 't': int(r[5])}
        seasons.setdefault(start, {'start': start, 'label': label, 'end': end, 'teams': []})['teams'].append(t)

out = []
for start in sorted(seasons):
    s = seasons[start]; c = champ.get(s['end'])
    for t in s['teams']:
        t['reg'] = (c['reg'].index(t['owner']) + 1) if c and t['owner'] in c['reg'] else None
        t['tourney'] = (c['tourney'].index(t['owner']) + 1) if c and t['owner'] in c['tourney'] else None
    # every placement named in the champions tab must match a team in that season
    if c:
        names = {t['owner'] for t in s['teams']}
        for k in ('reg', 'tourney'):
            for n in c[k]:
                if n not in names: print('WARN', s['label'], k, n, 'not in season teams', file=sys.stderr)
    out.append(s)

draft = []
for r in rows('Draft History'):
    if len(r) >= 5 and re.fullmatch(r'\d{4}', r[0].strip()):
        draft.append({'year': int(r[0]), 'pick': int(r[1]), 'player': r[2].strip(), 'team': r[3].strip(), 'owner': norm(r[4])})

open('src/data.js', 'w', encoding='utf-8').write(
    '// Sample data parsed from the commissioner spreadsheet (Raw + Reg/Tournament Champs + Draft History tabs).\n'
    '// Shape mirrors the Supabase tables so a live loader can replace this file.\n'
    'export const SEASONS = ' + json.dumps(out, ensure_ascii=False, indent=1) + ';\n'
    'export const DRAFT = ' + json.dumps(draft, ensure_ascii=False, indent=1) + ';\n')

# validate against the sheet's Record Book (W / L per owner)
tot = {}
for s in out:
    for t in s['teams']:
        a = tot.setdefault(t['owner'], [0, 0, 0, 0]); a[0] += t['w']; a[1] += t['l']; a[2] += t['t']; a[3] += 1
for o in ['Scotty', 'Craig', 'Smy', 'Aaron', 'Klink', 'AK', 'Cowan', 'Drewber', 'Owen', 'Brendan', 'Nate', 'Pete']:
    print(o, tot[o])
print('seasons', len(out), 'teams', sum(len(s['teams']) for s in out), 'draft picks', len(draft))
print('owners', sorted(tot))
