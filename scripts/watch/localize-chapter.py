"""Add the public smart watch chapter to all seven existing site catalogs."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[2] / 'src/i18n/locales'
entries = [
    ['demtsev.com/smart-watch', 'demtsev.com/smart-watch', 'demtsev.com/smart-watch', 'demtsev.com/smart-watch', 'demtsev.com/smart-watch', 'demtsev.com/smart-watch', 'demtsev.com/smart-watch'],
    ['Smart watch', 'Smartwatch', 'Montre intelligente', 'Orologio intelligente', 'Reloj inteligente', '智能腕表', 'Умные часы'],
    ['An independent experiment', 'Ein unabhängiges Experiment', 'Une expérience indépendante', 'Un esperimento indipendente', 'Un experimento independiente', '独立实验', 'Независимый эксперимент'],
    ['Swiss-inspired timekeeping and thoughtful AI, beautifully in balance.', 'Schweizer Uhrendesign und durchdachte KI, harmonisch vereint.', 'Une montre d’inspiration suisse et une IA réfléchie, en parfaite harmonie.', 'Tempo di ispirazione svizzera e un’IA attenta, in perfetto equilibrio.', 'Un reloj de inspiración suiza e IA reflexiva, en perfecto equilibrio.', '瑞士风格计时与用心设计的人工智能，和谐相融。', 'Часы в швейцарском стиле и продуманный ИИ в красивом балансе.'],
    ['Explore the watch', 'Die Uhr entdecken', 'Explorer la montre', 'Esplora l’orologio', 'Explora el reloj', '探索腕表', 'Открыть часы'],
    ['Smart watch · Daniil Emtsev', 'Smartwatch · Daniil Emtsev', 'Montre intelligente · Daniil Emtsev', 'Orologio intelligente · Daniil Emtsev', 'Reloj inteligente · Daniil Emtsev', '智能腕表 · Daniil Emtsev', 'Умные часы · Daniil Emtsev'],
    ['An original watch experiment: precise time, reviewed thoughts and three circular faces.', 'Ein originelles Uhrenexperiment: präzise Zeit, geprüfte Gedanken und drei runde Zifferblätter.', 'Une expérience horlogère originale : heure précise, pensées vérifiées et trois cadrans circulaires.', 'Un esperimento originale: tempo preciso, pensieri verificati e tre quadranti circolari.', 'Un experimento original: hora precisa, reflexiones revisadas y tres esferas circulares.', '原创腕表实验：精确计时、经过审核的思考，以及三种圆形表盘。', 'Оригинальный эксперимент: точное время, проверенные мысли и три круглых циферблата.'],
]
for index, code in enumerate(['en', 'de', 'fr', 'it', 'es', 'zh', 'ru']):
    file = root / f'{code}.json'
    catalog = json.loads(file.read_text())
    catalog.update({entry[0]: entry[index] for entry in entries})
    file.write_text(json.dumps(catalog, ensure_ascii=False, separators=(',', ':')) + '\n')
