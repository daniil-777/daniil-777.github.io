/**
 * Everything on the site that is not a project: who I am, where to find me,
 * the timeline, publications, awards and skills. Edit the text here.
 */

export const site = {
  name: 'Daniil Emtsev',
  role: 'AI Research Engineer',
  location: 'Zurich, Switzerland',
  url: 'https://demtsev.com',
  domain: 'demtsev.com',
  email: 'daniil.emtsev.ig@gmail.com',
  title: 'Daniil Emtsev · AI Research Engineer',
  description:
    'AI research engineer in Zurich. Real-time computer vision and language models for surgical training at VirtaMed, and generative AI that runs entirely in the browser. ETH Zurich MSc, a WACV paper and a patent application.',
};

export const hero = {
  eyebrow: 'AI Research Engineer · Zurich',
  /** The phrase in `accent` is drawn with the colour gradient. */
  headline: { before: 'AI that sees, guides and creates.', accent: 'In real time.' },
  lead: 'I build machine-learning systems that work in the moment: computer vision and language models that coach surgeons in training at VirtaMed, and generative AI that runs entirely in your browser.',
};

export const nav = [
  { label: 'About', href: '/#about' },
  { label: 'Work', href: '/#work' },
  { label: 'Journey', href: '/#journey' },
  { label: 'Research', href: '/#research' },
  { label: 'Contact', href: '/#contact' },
  { label: 'Smart watch', href: '/#smart-watch' },
];

export type LinkId = 'github' | 'linkedin' | 'scholar' | 'mail';

export const links: { id: LinkId; label: string; handle: string; href: string }[] = [
  { id: 'github', label: 'GitHub', handle: 'daniil-777', href: 'https://github.com/daniil-777' },
  { id: 'linkedin', label: 'LinkedIn', handle: 'in/emtsevdaniil', href: 'https://www.linkedin.com/in/emtsevdaniil/' },
  { id: 'scholar', label: 'Google Scholar', handle: 'Publications and citations', href: 'https://scholar.google.com/citations?hl=en&user=GoLS2IAAAAAJ' },
  { id: 'mail', label: 'Email', handle: site.email, href: `mailto:${site.email}` },
];

export const stats = [
  { value: '4.5 years', label: 'building AI for surgical simulators at VirtaMed' },
  { value: '60 → 90%', label: 'accuracy detecting anatomy in ultrasound' },
  { value: 'WACV 2021', label: 'publication on neural 3D reconstruction' },
  { value: '1 patent filing', label: 'an international application on 6D camera pose' },
];

export const bio = [
  'For the past 4.5 years, I’ve been a Machine Learning Research Engineer at VirtaMed in Zurich, building AI for surgical training. I take projects from model development to on-device applications and deployment, including computer vision, generative image enhancement and AI coaching systems.',
  'At ETH Zurich, I completed a master’s in Computational Science and Engineering, focusing on robotics. I co-authored a WACV paper on neural 3D reconstruction, co-invented a camera pose estimation method filed as an international patent application, and worked on de novo drug design in the Molecular Design Lab.',
  'I graduated with honours from the Moscow Institute of Physics and Technology. During an Amgen Scholars internship at ETH Zurich, I used generative adversarial networks to study Alzheimer’s-related brain changes and presented the work at the Amgen Scholars Symposium in Cambridge.',
  'Alongside my industry work, I build independent AI applications for art, real-time 2D and 3D generation, autonomous navigation and financial analysis. I’m also developing a fast browser-based AI library to make advanced models more accessible.',
];

export const facts = [
  { label: 'Based in', value: 'Zurich, Switzerland' },
  { label: 'Languages', value: 'English (C1), German (B1), Russian (native)' },
];

export interface JourneyEntry {
  period: string;
  title: string;
  organisation: string;
  place: string;
  kind: 'work' | 'education';
  points: string[];
  /** Project ids (file names in src/content/projects) to link from this entry. */
  projects: string[];
}

export const journey: JourneyEntry[] = [
  {
    period: '2022 – now',
    title: 'Machine Learning Research Engineer',
    organisation: 'VirtaMed',
    place: 'Zurich',
    kind: 'work',
    points: [
      'Real-time computer vision in PyTorch for a browser app that analyses live camera input, with inference running fully client-side.',
      'LLM-based guidance and automated report generation integrated into surgical simulators.',
      'Transformer-based detection of anatomy in ultrasound, from 60% to 90% accuracy.',
      'A texture-enhancement system for visual realism, and a scalable pipeline that turns 3D simulation output into training data.',
      'End-to-end MLOps on Azure ML and DVC for reproducible training, versioning and deployment.',
      'Teaching: AI lectures at VirtaMed, supervising students from Swiss universities, and contributing to Innosuisse surgical proficiency projects.',
    ],
    projects: ['ai-proctor', 'laparoscopic-skills-trainer', 'generative-realism', 'ultrasound-anatomy-detection'],
  },
  {
    period: '2019 – 2022',
    title: 'MSc Computational Science and Engineering',
    organisation: 'ETH Zurich',
    place: 'Zurich',
    kind: 'education',
    points: [
      'Focus on robotics. Master’s thesis in the Computer Vision Lab, graded 5.75 out of 6.',
      'Supported by the ETH Zurich Master’s Scholarship, covering full tuition and living expenses.',
    ],
    projects: ['camera-pose-2d3d', 'dynamic-plane-onet', 'de-novo-drug-design'],
  },
  {
    period: 'Summer 2019',
    title: 'R&D Software Engineer, Internship',
    organisation: 'Data Analytics Group',
    place: 'Moscow',
    kind: 'work',
    points: [
      'Co-developed a scalable topological method, persistence barcodes, for analysing the loss landscapes of neural networks.',
    ],
    projects: ['loss-landscape-barcodes'],
  },
  {
    period: 'Summer 2018',
    title: 'R&D Software Engineer, Internship',
    organisation: 'Amgen Scholars Program',
    place: 'Zurich',
    kind: 'work',
    points: [
      'Used generative adversarial networks to characterise structural brain changes of Alzheimer’s disease in MRI scans.',
      'Presented the method and findings at the Cambridge Amgen Scholars Symposium.',
    ],
    projects: ['alzheimers-gan'],
  },
  {
    period: '2015 – 2019',
    title: 'BSc Computer Science and Electrical Engineering',
    organisation: 'Moscow Institute of Physics and Technology',
    place: 'Moscow',
    kind: 'education',
    points: [
      'Focus on data science. GPA 9.0 out of 10, graduated with distinction.',
      'Lecturer at the MIPT Education Center, 2016 – 2017: designed and taught Olympiad courses in electrostatics and geometry, and wrote a problem book of original questions with solutions.',
    ],
    projects: [],
  },
];

/**
 * The citation of a document shown in the Research section. The document itself
 * (title, PDF, original source, project) is declared once, in the `documents`
 * of its project's frontmatter.
 */
export interface Publication {
  /** A document id from `documents` in src/content/projects/*.md. */
  document: string;
  authors: string;
  venue: string;
  year: string;
}

export const publications: Publication[] = [
  {
    document: 'camera-pose-patent',
    authors: 'W. Abbeloos, D. Emtsev, D. P. Paudel, V. Patil, A. Obukhov, L. Van Gool',
    venue: 'International patent application WO2023186262A1',
    year: '2023',
  },
  {
    document: 'dynamic-plane-onet-paper',
    authors: 'S. Lionar*, D. Emtsev*, D. Svilarkovic*, S. Peng',
    venue: 'Winter Conference on Applications of Computer Vision (WACV)',
    year: '2021',
  },
  {
    document: 'loss-landscape-barcodes-paper',
    authors: 'S. Barannikov, A. Korotin, D. Oganesyan, D. Emtsev, E. Burnaev',
    venue: 'Doklady Rossiiskoi Akademii Nauk. Matematika, Informatika, Protsessy Upravleniya, vol. 514, no. 2',
    year: '2023',
  },
  {
    document: 'alzheimers-poster',
    authors: 'D. Emtsev, C. F. Baumgartner, E. Konukoglu',
    venue: 'Poster, Cambridge Amgen Scholars Symposium',
    year: '2018',
  },
];

export const awards = [
  { title: 'ETH Zurich Master’s Scholarship', detail: 'Full tuition and living expenses', year: '2019' },
  { title: 'Singapore International Pre-Graduate Award', detail: 'Bioinformatics', year: '2019' },
  { title: 'Abramov Scholarship for Academic Excellence', detail: 'MIPT', year: '2016 – 2019' },
  { title: 'All-Russian Math and Physics Olympiad', detail: 'Winner', year: '2015' },
  { title: 'Tournament of Towns Math Competition', detail: 'Winner', year: '2013' },
  { title: 'International Math and Physics Olympiad, Belgrade', detail: 'Silver medal', year: '2013' },
];

export const skills = [
  { group: 'Programming languages', items: ['Python', 'TypeScript', 'C++', 'C#', 'C', 'R', 'MATLAB', 'Java'] },
  { group: 'Machine learning', items: ['PyTorch', 'TensorFlow', 'TensorFlow.js', 'OpenCV', 'scikit-learn', 'NumPy', 'Pandas'] },
  { group: '3D and numerics', items: ['Eigen', 'Libigl', 'Boost', 'Unity'] },
  { group: 'Platform', items: ['Azure ML', 'Azure DevOps', 'DVC', 'Docker', 'Google Cloud', 'Git', 'Bash'] },
];

export const interests = ['Biking', 'Hiking', 'Travelling', 'Museums', 'Chess', 'Tennis', 'Swimming', 'Running'];
