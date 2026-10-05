"""Build original, source-reviewed public watch sentences. No private CV extraction."""
import json
from pathlib import Path

AS_OF = '2026-10-05'
sources = {
    'attention': ('Attention Is All You Need', 'https://arxiv.org/abs/1706.03762', '2017-06-12'),
    'gqa': ('Grouped-query attention', 'https://arxiv.org/abs/2305.13245', '2023-12-23'),
    'rope': ('RoFormer: rotary position embeddings', 'https://arxiv.org/abs/2104.09864', '2023-11-08'),
    'dqn': ('Playing Atari with Deep Reinforcement Learning', 'https://arxiv.org/abs/1312.5602', '2013-12-19'),
    'validation': ('scikit-learn: cross-validation', 'https://scikit-learn.org/stable/modules/cross_validation.html', AS_OF),
    'portfolio': ('Daniil’s public portfolio and CV', 'https://demtsev.com/#about', AS_OF),
    'journey': ('Daniil’s public journey', 'https://demtsev.com/#journey', AS_OF),
    'research': ('Daniil’s public research', 'https://demtsev.com/#research', AS_OF),
    'activity': ('WHO: physical activity', 'https://www.who.int/news-room/fact-sheets/detail/physical-activity', '2024-06-26'),
    'stress': ('WHO: stress', 'https://www.who.int/news-room/questions-and-answers/item/stress', '2026-03-30'),
}
# Each answer is an independently written paraphrase, never a quoted passage.
rows = [
    ('ai', 'attention', 'attention', 'Attention compares a query with keys, weighting values to build a context-dependent representation.'),
    ('ai', 'transformer', 'attention', 'The original Transformer used attention instead of recurrence to model relationships across a sequence.'),
    ('ai', 'multi-head', 'attention', 'Multi-head attention lets different learned projections attend to different relationships in the same sequence.'),
    ('ai', 'causal mask', 'attention', 'A causal attention mask prevents a decoder from attending to future tokens during training.'),
    ('ai', 'position', 'attention', 'Position information helps a Transformer distinguish the order of tokens in its input sequence.'),
    ('ai', 'grouped-query', 'gqa', 'Grouped-query attention shares key and value heads among several query heads during attention computation.'),
    ('ai', 'rotary embeddings', 'rope', 'Rotary position embeddings encode token positions by rotating vectors inside the attention mechanism.'),
    ('ai', 'q-learning', 'dqn', 'A deep Q-network estimates future rewards for available actions from an observed state.'),
    ('ai', 'held-out testing', 'validation', 'A held-out test set evaluates a model after training and model selection are complete.'),
    ('ai', 'data leakage', 'validation', 'Fitting preprocessing on test data leaks information and can make evaluation results overly optimistic.'),
    ('ai', 'group splits', 'validation', 'Group-aware splitting keeps related samples together, reducing leakage between training and evaluation sets.'),
    ('ai', 'cross-validation', 'validation', 'Cross-validation rotates held-out folds to estimate how well a model generalizes to unseen samples.'),
    ('profile', 'Zurich', 'portfolio', 'Daniil Emtsev is an AI research engineer based in Zurich, Switzerland.'),
    ('profile', 'surgical training', 'portfolio', 'Daniil builds computer vision and language-model systems that support surgical training at VirtaMed.'),
    ('profile', 'ETH Zurich master', 'journey', 'Daniil completed a master’s in Computational Science and Engineering at ETH Zurich, focusing on robotics.'),
    ('profile', 'master thesis', 'journey', 'Daniil’s ETH Zurich master’s thesis in computer vision received a grade of 5.75 out of six.'),
    ('profile', 'MIPT bachelor', 'journey', 'Daniil graduated with distinction from MIPT, studying computer science and electrical engineering.'),
    ('profile', 'ultrasound', 'journey', 'Daniil’s public portfolio reports improved ultrasound anatomy detection accuracy, from sixty to ninety percent.'),
    ('profile', 'WACV reconstruction', 'research', 'Daniil co-authored a WACV 2021 paper on dynamic-plane convolutional occupancy networks for neural reconstruction.'),
    ('profile', 'camera pose', 'research', 'Daniil co-invented a camera pose method described in international patent application WO2023186262A1.'),
    ('profile', 'Amgen Scholars', 'journey', 'During his Amgen Scholars internship, Daniil studied Alzheimer’s-related brain changes using generative adversarial networks.'),
    ('profile', 'Cambridge', 'journey', 'Daniil presented his Amgen Scholars research on brain imaging at the symposium in Cambridge.'),
    ('profile', 'loss landscapes', 'journey', 'Daniil co-developed persistence-barcode methods for analysing neural-network loss landscapes during an internship in 2019.'),
    ('profile', 'browser AI', 'portfolio', 'Daniil’s independent projects explore browser-based AI for art, generation, autonomous navigation and financial analysis.'),
    ('wellbeing', 'movement', 'activity', 'Even a little physical activity contributes more than none, according to WHO guidance.'),
    ('wellbeing', 'walking', 'activity', 'Walking, cycling and everyday movement all count as physical activity in WHO guidance.'),
    ('wellbeing', 'sitting', 'activity', 'WHO recommends limiting sedentary time; small opportunities for movement can fit into everyday life.'),
    ('wellbeing', 'routine', 'stress', 'A regular daily schedule can support a sense of control during stressful periods.'),
    ('wellbeing', 'sleep schedule', 'stress', 'Keeping consistent bedtime and waking times is one sleep habit suggested by WHO.'),
    ('wellbeing', 'sleep environment', 'stress', 'A quiet, dark and comfortable sleeping environment can support healthy sleep habits.'),
    ('wellbeing', 'connection', 'stress', 'Sharing concerns with someone you trust can help you feel more connected during stress.'),
    ('wellbeing', 'screen habits', 'stress', 'WHO suggests limiting electronic-device use before bedtime as part of healthy sleep habits.'),
    ('wellbeing', 'news', 'stress', 'If following the news increases your stress, consider setting limits on that time.'),
    ('wellbeing', 'different responses', 'stress', 'People respond to stressful situations differently, and their coping styles can vary.'),
]

facts = []
for index, (mode, topic, source_id, answer) in enumerate(rows, 1):
    words = len(answer.split())
    assert 10 <= words <= 20, (answer, words)
    title, url, date = sources[source_id]
    facts.append({
        'id': f'{mode}-{index:03d}', 'mode': mode, 'topic': topic,
        'text': answer, 'answer': answer, 'sourceId': source_id,
        'sourceTitle': title, 'sourceUrl': url, 'sourceDate': date,
        'reviewedAt': AS_OF, 'freshnessPolicy': 'Re-review annually or when the cited source changes.',
        'rights': 'Original factual paraphrase with attribution; profile facts supplied for public publication by the owner.',
        'publicAllowed': True, 'reviewStatus': 'reviewed',
    })
# New catalog entries are original factual summaries, not copied source passages.
# Source pages are references for verification; full source text is never ingested.
catalog = json.loads((Path(__file__).parent / 'fact-catalog.json').read_text())
for source in catalog['sources']:
    for item in source['rows']:
        answer = item['answer']
        assert 10 <= len(answer.split()) <= 20 and len(answer) <= 125, answer
        assert not any(term in answer.lower().split() for term in ['diagnose', 'dosage', 'cure', 'guarantee'])
        facts.append({
            'id': f"ai-{len(facts) + 1:03d}", 'mode': 'ai', 'domain': source['domain'], 'topic': item['topic'],
            'text': answer, 'answer': answer, 'sourceId': source['sourceId'],
            'sourceTitle': item.get('sourceTitle', source['sourceTitle']), 'sourceUrl': item.get('sourceUrl', source['sourceUrl']),
            'sourceDate': source['sourceDate'], 'sourceDateKind': source['sourceDateKind'],
            'reviewedAt': AS_OF, 'freshnessPolicy': 'Re-review annually or when the cited source changes.',
            'rights': 'Original agent-authored factual sentence with attribution; no source passage, figure or source corpus was copied.',
            'reviewMethod': source['reviewMethod'], 'independentHumanReview': False,
            'publicAllowed': True, 'reviewStatus': 'reviewed',
        })
target = Path(__file__).resolve().parents[2] / 'public/watch/facts.v1.json'
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps({'version': 'chronos-facts-2026-10-05.2-expanded-citation1', 'asOf': AS_OF, 'language': 'en', 'facts': facts}, indent=2) + '\n')
print(f'{len(facts)} reviewed public facts → {target}')
