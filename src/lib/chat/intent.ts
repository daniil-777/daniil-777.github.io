/** Conservative personal routing shared by the model gate and citation guard. */
export function scopedPortfolioOwner(question: string): boolean {
  return /\b(?:owner|author|creator|developer) of (?:this|the) (?:web ?site|site|portfolio)\b|\b(?:the|this) (?:web ?site|site|portfolio) (?:owner|author|creator|developer)\b|\bwho (?:owns|created|built) this (?:web ?site|site|portfolio)\b/i.test(question) ||
    (/\bthis (?:engineer|developer|researcher|person)\b/i.test(question) && /\b(?:work(?:s|ed)? (?:for|at)|where\b.{0,50}\bwork|employer|employed|graduat\w*|stud(?:y|ies|ied)|school|educational|degree|salary|career|background)\b/i.test(question));
}
export function hasPersonalIntent(question: string): boolean {
  const q = question.normalize('NFC');
  if (scopedPortfolioOwner(q)) return true;
  // JS \b is ASCII-only: it misses Cyrillic names and accented pronouns.
  if (/(?<!\p{L})(?:Daniil|Emtsev|Даниил|Даниила|Даниилу|Емцев|Емцева|he|his|him|your|yours|yourself|candidate|applicant|VirtaMed|ETH|MIPT|salary|availability|available|notice period|start date|career|CV|projects|portfolio|publications|patents|qualifications|current role|professional background)(?!\p{L})/iu.test(q)) return true;
  if (/(?<!\p{L})(?:er|ihm|ihn|sein|seine|seinen|du|dein|deine|il|lui|son|sa|ses|votre|vous|él|su|sus|tú|tu|tus|usted|suo|sua|suoi|sue|lei|его|ему|он|него|кандидат|кандидата|зарплата|зарплату|резюме|карьера|портфолио|публикации|patentes|currículum|candidato|candidata|salario|stipendio|Gehalt|Lebenslauf|salaire)(?!\p{L})/iu.test(q)) return true;
  if (/丹尼尔|叶姆采夫|他的|他在|他是|他能|你在|你的|候选人|简历|薪资|薪水/.test(q)) return true;
  if (/\b(?:work|experience|degree|background)\b.{0,40}\b(?:you|u)\b/i.test(q)) return true;
  return /\b(?:you|u)\b.{0,30}\b(?:work|worked|build|built|study|studied|graduate|graduated|live|teach|manage|earn)\b/i.test(q);
}
