"""Add the public Chronos chapter to all seven existing site catalogs."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[2] / 'src/i18n/locales'
entries = [
    ['demtsev.com/smart-watch', 'demtsev.com/smart-watch', 'demtsev.com/smart-watch', 'demtsev.com/smart-watch', 'demtsev.com/smart-watch', 'demtsev.com/smart-watch', 'demtsev.com/smart-watch'],
    ['Smart watch', 'Smartwatch', 'Montre intelligente', 'Orologio intelligente', 'Reloj inteligente', '智能腕表', 'Умные часы'],
    ['An independent experiment', 'Ein unabhängiges Experiment', 'Une expérience indépendante', 'Un esperimento indipendente', 'Un experimento independiente', '独立实验', 'Независимый эксперимент'],
    ['Swiss-inspired timekeeping, thoughtful AI and a little flight around the dial.', 'Schweizer Uhrendesign, durchdachte KI und ein kleiner Flug um das Zifferblatt.', 'Une montre d’inspiration suisse, une IA réfléchie et un petit vol autour du cadran.', 'Una misurazione del tempo ispirata alla Svizzera, un’IA attenta e un piccolo volo intorno al quadrante.', 'Un reloj de inspiración suiza, IA reflexiva y un pequeño vuelo alrededor de la esfera.', '瑞士风格计时、用心设计的人工智能，以及绕表盘飞行的小飞机。', 'Часы в швейцарском стиле, продуманный ИИ и небольшой полёт вокруг циферблата.'],
    ['Explore Chronos', 'Chronos entdecken', 'Explorer Chronos', 'Esplora Chronos', 'Explora Chronos', '探索 Chronos', 'Открыть Chronos'],
    ['Chronos · Smart watch · Daniil Emtsev', 'Chronos · Smartwatch · Daniil Emtsev', 'Chronos · Montre intelligente · Daniil Emtsev', 'Chronos · Orologio intelligente · Daniil Emtsev', 'Chronos · Reloj inteligente · Daniil Emtsev', 'Chronos · 智能腕表 · Daniil Emtsev', 'Chronos · Умные часы · Daniil Emtsev'],
    ['An original watch experiment: precise time, reviewed thoughts and a locally trained aircraft controller.', 'Ein originelles Uhrenexperiment: präzise Zeit, geprüfte Gedanken und eine lokal trainierte Flugzeugsteuerung.', 'Une expérience horlogère originale : heure précise, pensées vérifiées et commande d’avion entraînée localement.', 'Un esperimento originale: tempo preciso, pensieri verificati e un controllore di volo addestrato localmente.', 'Un experimento original: hora precisa, reflexiones revisadas y un controlador de vuelo entrenado localmente.', '原创腕表实验：精确计时、经过审核的思考，以及本地训练的飞行控制器。', 'Оригинальный эксперимент: точное время, проверенные мысли и локально обученный контроллер самолёта.'],
]
for index, code in enumerate(['en', 'de', 'fr', 'it', 'es', 'zh', 'ru']):
    file = root / f'{code}.json'
    catalog = json.loads(file.read_text())
    catalog.update({entry[0]: entry[index] for entry in entries})
    file.write_text(json.dumps(catalog, ensure_ascii=False, separators=(',', ':')) + '\n')
