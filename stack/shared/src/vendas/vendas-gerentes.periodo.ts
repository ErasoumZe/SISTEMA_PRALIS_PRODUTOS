export type ModoGerentes = 'mes' | 'semana' | 'dia';
export interface PeriodoGerentes { inicio: string; fim: string }

const iso = (d: Date) => d.toISOString().slice(0, 10);
const dataUtc = (ano: number, mes: number, dia: number) => new Date(Date.UTC(ano, mes - 1, dia));
const adicionarDias = (d: Date, dias: number) => new Date(d.getTime() + dias * 86_400_000);

export function diasNoMes(mes: string): number {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new Error('Mês inválido.');
  const [ano, numero] = mes.split('-').map(Number);
  return new Date(Date.UTC(ano!, numero!, 0)).getUTCDate();
}

export function semanasDoMes(mes: string): PeriodoGerentes[] {
  const [ano, numero] = mes.split('-').map(Number);
  const primeiro = dataUtc(ano!, numero!, 1);
  // Semana gerencial: segunda a sábado. Domingo não entra. Se o dia 1 cair
  // no domingo, a primeira semana começa na segunda seguinte.
  const diaSemana = primeiro.getUTCDay();
  let segunda = adicionarDias(primeiro, diaSemana === 0 ? 1 : 1 - diaSemana);
  const ultimo = dataUtc(ano!, numero!, diasNoMes(mes));
  const semanas: PeriodoGerentes[] = [];
  while (segunda <= ultimo) {
    semanas.push({ inicio: iso(segunda), fim: iso(adicionarDias(segunda, 5)) });
    segunda = adicionarDias(segunda, 7);
  }
  return semanas;
}

export function periodoGerentes(mes: string, modo: ModoGerentes, dia?: string, semana?: number): PeriodoGerentes {
  const ultimoDia = diasNoMes(mes);
  if (modo === 'mes') return { inicio: `${mes}-01`, fim: `${mes}-${String(ultimoDia).padStart(2, '0')}` };
  if (modo === 'semana') {
    const semanas = semanasDoMes(mes);
    if (!Number.isInteger(semana) || semana! < 1 || semana! > semanas.length) throw new Error('Semana inválida para este mês.');
    return semanas[semana! - 1]!;
  }
  if (!/^\d{1,2}$/.test(dia ?? '') || Number(dia) < 1 || Number(dia) > ultimoDia) {
    throw new Error(`Informe um dia entre 1 e ${ultimoDia}.`);
  }
  const data = `${mes}-${String(Number(dia)).padStart(2, '0')}`;
  return { inicio: data, fim: data };
}

export function mesAtualSaoPaulo(agora = new Date()): string {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit',
  }).formatToParts(agora);
  const ano = partes.find((p) => p.type === 'year')?.value;
  const mes = partes.find((p) => p.type === 'month')?.value;
  return `${ano}-${mes}`;
}
