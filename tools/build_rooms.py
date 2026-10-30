"""엑셀(전체_건물_호실_통합) → map-data.json 의 floors[].rooms 로 병합"""
import json, re, sys
import pandas as pd

XLSX, JSON_PATH = sys.argv[1], sys.argv[2]

# 엑셀 '건물' → map-data buildingId  (층 조건이 있으면 해당 층만)
BUILDING_MAP = [
    ('공학관 건물 안내도(본관)', None, 'eng_main'),
    # '공학관 공과대학 실험동' 시트는 B1·1F·2F = 공학실험동, 4F 이상 = 공학관 본관 호실
    ('공학관 공과대학 실험동', {'B1', '1', '2'}, 'eng_exp'),
    ('공학관 공과대학 실험동', None, 'eng_main'),
    ('예술디자인대학관', None, 'art_design'),
    ('전자정보대학', None, 'eecs'),
    ('국제학관', None, 'int_hall'),
    ('학생회관', None, 'student_hall'),
    ('체육대학', None, 'pe_college'),
    ('외국어대학 A동', None, 'foreign_lang'),
    ('외국어대학 B동', None, 'foreign_lang'),
    ('외국어대학 C동', None, 'foreign_lang'),
    # '공학실험동'(Building_Directories)은 위 '공과대학 실험동'과 호실이 전부 겹치고
    # 수정본이 아닌 이전 판독본이라 사용하지 않음
]

def norm_floor(f):
    return re.sub(r'F$', '', str(f).strip().upper())

def sort_key(label):
    m = re.match(r'([A-Z]*)(\d+)(.*)', label.upper())
    if not m: return (9, '', 0, label)
    pre, num, rest = m.groups()
    order = {'B': 0, '': 1}.get(pre, 2)
    return (order, pre, int(num), rest)

df = pd.read_excel(XLSX, engine='calamine', dtype=str)
df = df.fillna('')
df['호실'] = df['호실'].str.strip()
df['시설명'] = df['시설명'].str.strip()
# 번호 미확인 / 번호 없음 제외
df = df[~df['호실'].str.contains('번호', regex=False) & (df['호실'] != '')]

data = json.load(open(JSON_PATH, encoding='utf-8'))
by_id = {b['buildingId']: b for b in data}
for b in data:
    for f in b['floors']:
        f.pop('rooms', None)

skipped, used = [], 0
for _, row in df.iterrows():
    fk = norm_floor(row['층'])
    bid = None
    for name, floors, target in BUILDING_MAP:
        if row['건물'] == name and (floors is None or fk in floors):
            bid = target; break
    if not bid:
        skipped.append((row['건물'], row['층'], row['호실'], '건물 매핑 없음')); continue
    floor = next((f for f in by_id[bid]['floors'] if norm_floor(f['floor']) == fk), None)
    if not floor:
        skipped.append((row['건물'], row['층'], row['호실'], f'{bid}에 해당 층 도면 없음')); continue
    rooms = floor.setdefault('rooms', [])
    if any(r['number'] == row['호실'] for r in rooms):
        skipped.append((row['건물'], row['층'], row['호실'], '중복')); continue
    rooms.append({'number': row['호실'], 'name': row['시설명']})
    used += 1

for b in data:
    for f in b['floors']:
        if 'rooms' in f:
            f['rooms'].sort(key=lambda r: sort_key(r['number']))

json.dump(data, open(JSON_PATH, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('반영:', used)
for s in skipped: print('제외:', s)
