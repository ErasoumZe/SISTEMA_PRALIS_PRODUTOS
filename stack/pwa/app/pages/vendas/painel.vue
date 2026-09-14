<script setup lang="ts">
import { VendasDatas } from '@pralis/shared';
import type { VendasRankingResposta, ItemRanking } from '~/composables/useApi';

/**
 * Painel de setores — a tela de parede.
 *
 * É um placar de jogo: cada setor é um competidor, a ordem é a classificação,
 * e quando alguém ultrapassa outro a linha SOBE — não some e reaparece. O
 * movimento é o que conta a história.
 *
 * DINHEIRO NÃO APARECE AQUI. Nem em número, nem por escrito: nada de
 * "faturamento", nada de "× 25%". A tela fica num monitor à vista de quem
 * trabalha no salão, e o valor é pontuação, ponto final. O corte de verdade é
 * no servidor — a resposta chega sem os valores para quem não é administrador.
 *
 * TEMPO REAL: o robô manda lote diário. Esta tela relê sozinha a cada 60 s e
 * anima o que mudou; enquanto a fonte for diária, ela muda uma vez por dia. O
 * rodapé mostra a hora da última leitura para ninguém confundir tela parada com
 * loja parada.
 */
definePageMeta({ layout: 'default' });

const api = useApi();
const { user } = useAuth();
const isAdmin = computed(() => user.value?.role === 'admin');

const hoje = new Date();
const iso = VendasDatas.dataLocalISO;

const loja = ref<'TNP' | 'LI'>(user.value?.loja === 'LI' ? 'LI' : 'TNP');

/** Recortes que fazem sentido numa parede: o dia, a semana, o mês. */
const PERIODOS = [
  { dias: 0, label: 'Hoje' },
  { dias: 6, label: 'Semana' },
  { dias: 29, label: 'Mês' },
] as const;
const periodo = ref<0 | 6 | 29>(0);

const inicio = computed(() => iso(VendasDatas.diasAntes(hoje, periodo.value)));
const fim = computed(() => iso(hoje));

const dados = ref<VendasRankingResposta | null>(null);
const erro = ref('');
const carregando = ref(false);
const lidoEm = ref<Date | null>(null);
const posicaoAnterior = ref<Map<string, number>>(new Map());

/**
 * "Sem classificação no cadastro" NÃO disputa o pódio.
 *
 * Ele não é um setor: é o buraco do cadastro — produto que casou com a venda
 * mas está sem setor preenchido. Deixá-lo competir coloca um não-setor em
 * primeiro lugar e desmoraliza o placar inteiro para quem está competindo de
 * verdade. Sai da lista e vira um aviso discreto no rodapé.
 */
const CHAVE_SEM_SETOR = '__sem_valor__';

const competidores = computed<ItemRanking[]>(() => {
  const itens = (dados.value?.itens ?? []).filter((i) => i.chave !== CHAVE_SEM_SETOR);
  /* Reposiciona: tirar um da lista não pode deixar buraco de numeração. */
  return itens.map((i, idx) => ({ ...i, posicao: idx + 1 }));
});

const semSetor = computed(() =>
  (dados.value?.itens ?? []).find((i) => i.chave === CHAVE_SEM_SETOR) ?? null);

async function carregar() {
  carregando.value = true;
  try {
    const r = await api.vendasRanking({
      ...(isAdmin.value ? { loja: loja.value } : {}),
      inicio: inicio.value,
      fim: fim.value,
      dimensao: 'setor',
    });
    /* Guarda as posições ANTES de trocar: é o que revela a ultrapassagem. */
    if (dados.value) {
      posicaoAnterior.value = new Map(competidores.value.map((i) => [i.chave, i.posicao]));
    }
    dados.value = r;
    lidoEm.value = new Date();
    erro.value = '';
  } catch (e: unknown) {
    erro.value = (e as { data?: { message?: string } })?.data?.message
      || 'Não foi possível ler o placar.';
  } finally {
    carregando.value = false;
  }
}

/** 60 s é folgado: a fonte muda por lote, não por venda. */
const INTERVALO_MS = 60_000;
let relogio: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  carregar();
  relogio = setInterval(carregar, INTERVALO_MS);
});
onBeforeUnmount(() => { if (relogio) clearInterval(relogio); });

watch([loja, periodo], carregar);

const movimento = (chave: string, posicao: number): number => {
  const antes = posicaoAnterior.value.get(chave);
  return antes == null ? 0 : antes - posicao;
};

const lider = computed(() => competidores.value[0] ?? null);
const pontos = (v: number) => Math.round(v).toLocaleString('pt-BR');
const hora = (d: Date | null) => (d ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—');

/** Barra proporcional ao líder — a distância para o primeiro, de relance. */
const fatia = (v: number) => {
  const topo = lider.value?.pontos ?? 0;
  return topo > 0 ? Math.max(3, (v / topo) * 100) : 0;
};

/** Só o pódio ganha medalha — do quarto em diante o número basta. */
const MEDALHAS = ['ouro', 'prata', 'bronze'] as const;
const medalha = (posicao: number) => MEDALHAS[posicao - 1] ?? null;

/** Nome curto: `PROD. - PANIFICAÇÃO` numa parede vira só `PANIFICAÇÃO`. */
const nomeCurto = (rotulo: string) => rotulo.replace(/^(PROD\.|LJ)\s*-\s*/i, '').trim();
const origem = (rotulo: string) => (/^PROD\./i.test(rotulo) ? 'Produção' : /^LJ/i.test(rotulo) ? 'Loja' : '');
</script>

<template>
  <div class="placar">
    <div class="placar-topo">
      <div>
        <h1 class="placar-titulo">Placar de setores</h1>
        <!--
          O subtítulo diz o RECORTE e a loja. Nada de "faturamento × 25%": a
          regra da pontuação não pode aparecer aqui, porque dela se deduz o
          dinheiro.
        -->
        <div class="placar-sub">
          {{ PERIODOS.find((p) => p.dias === periodo)?.label }} · {{ loja === 'LI' ? 'Lisboa' : 'TNP' }}
        </div>
      </div>

      <div class="placar-controles">
        <button
          v-for="p in PERIODOS"
          :key="p.dias"
          type="button"
          class="pilula"
          :class="{ 'pilula--ativa': periodo === p.dias }"
          @click="periodo = p.dias"
        >{{ p.label }}</button>
        <button
          v-if="isAdmin"
          type="button"
          class="pilula pilula--loja"
          @click="loja = loja === 'TNP' ? 'LI' : 'TNP'"
        >{{ loja === 'TNP' ? 'TNP' : 'Lisboa' }}</button>
      </div>
    </div>

    <div v-if="erro" class="placar-aviso">{{ erro }}</div>
    <div v-else-if="!dados" class="placar-vazio">Carregando o placar…</div>
    <div v-else-if="!competidores.length" class="placar-vazio">
      Nenhum setor pontuou neste período.
    </div>

    <template v-else>
      <TransitionGroup name="linha" tag="div" class="placar-linhas">
        <article
          v-for="i in competidores"
          :key="i.chave"
          class="cartao"
          :class="[`cartao--${medalha(i.posicao) ?? 'comum'}`, { 'cartao--lider': i.posicao === 1 }]"
        >
          <div class="cartao-posicao">
            <span class="posicao-numero">{{ i.posicao }}</span>
            <span
              v-if="movimento(i.chave, i.posicao) !== 0"
              class="posicao-mov"
              :class="movimento(i.chave, i.posicao) > 0 ? 'subiu' : 'desceu'"
            >
              {{ movimento(i.chave, i.posicao) > 0 ? '▲' : '▼' }}{{ Math.abs(movimento(i.chave, i.posicao)) }}
            </span>
          </div>

          <div class="cartao-identidade">
            <div class="setor-nome">{{ nomeCurto(i.rotulo) }}</div>
            <div v-if="origem(i.rotulo)" class="setor-origem">{{ origem(i.rotulo) }}</div>
            <div class="setor-trilho"><span :style="{ width: `${fatia(i.pontos)}%` }" /></div>
          </div>

          <div class="cartao-pontos">
            <span class="pontos-numero">{{ pontos(i.pontos) }}</span>
            <span class="pontos-rotulo">pontos</span>
          </div>
        </article>
      </TransitionGroup>

      <footer class="placar-rodape">
        <span>Atualizado às <strong>{{ hora(lidoEm) }}</strong></span>
        <span v-if="carregando" class="rodape-lendo">atualizando…</span>
        <!--
          O aviso do cadastro fica pequeno e sem número de dinheiro: serve para
          o gestor perceber que há produto sem setor, não para competir.
        -->
        <span v-if="semSetor" class="rodape-pendencia">
          há vendas sem setor no cadastro — elas não pontuam para ninguém
        </span>
      </footer>
    </template>
  </div>
</template>

<style scoped>
/*
 * O placar usa as cores da casa — roxo Cicluz e um azul profundo —, mas foscas
 * e em camadas, não chapadas. A superfície é quase preta com um brilho roxo ao
 * fundo; os cartões são translúcidos por cima dela. É isso que dá a leitura
 * "premium" sem inventar uma paleta que não é do sistema.
 */
.placar {
  --roxo: #6515DD;
  --roxo-fosco: rgba(101, 21, 221, 0.22);
  --azul: #4C8DFF;
  --azul-fundo: #0C1024;
  --tinta: #F3F1FF;
  --tinta-fraca: rgba(243, 241, 255, 0.52);
  --borda: rgba(255, 255, 255, 0.09);

  position: relative;
  overflow: hidden;
  border-radius: 22px;
  padding: 28px 26px 18px;
  min-height: 74vh;
  color: var(--tinta);
  background:
    radial-gradient(1100px 520px at 12% -12%, rgba(101, 21, 221, 0.42), transparent 62%),
    radial-gradient(900px 480px at 92% 6%, rgba(76, 141, 255, 0.26), transparent 60%),
    linear-gradient(168deg, #131038 0%, var(--azul-fundo) 58%, #080B18 100%);
  font-feature-settings: 'tnum' 1;
}

.placar-topo {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 22px;
}

/*
 * Tracking NEGATIVO e peso alto: é o que faz um título grande parecer
 * desenhado em vez de esticado. Maiúsculas com espaçamento largo, como estava
 * antes, lembram etiqueta de aeroporto — e era exatamente o que estava feio.
 */
.placar-titulo {
  font-size: clamp(26px, 3.4vw, 40px);
  font-weight: 700;
  letter-spacing: -0.022em;
  line-height: 1.05;
  margin: 0;
}

.placar-sub {
  margin-top: 6px;
  font-size: 13px;
  color: var(--tinta-fraca);
  letter-spacing: 0.01em;
}

.placar-controles { display: flex; flex-wrap: wrap; gap: 8px; }

.pilula {
  appearance: none;
  border: 1px solid var(--borda);
  background: rgba(255, 255, 255, 0.045);
  color: var(--tinta-fraca);
  border-radius: 999px;
  padding: 7px 16px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 220ms ease, color 220ms ease, border-color 220ms ease;
}
.pilula:hover { background: rgba(255, 255, 255, 0.08); color: var(--tinta); }
.pilula--ativa {
  background: linear-gradient(135deg, var(--roxo), #7C3AED);
  border-color: transparent;
  color: #fff;
  box-shadow: 0 6px 18px rgba(101, 21, 221, 0.4);
}
.pilula--loja { border-color: rgba(76, 141, 255, 0.4); }

.placar-linhas { display: flex; flex-direction: column; gap: 10px; }

/*
 * Cartão de vidro: fundo translúcido, desfoque atrás e uma borda de um pixel.
 * O desfoque é o que faz a camada parecer material em vez de retângulo pintado.
 */
.cartao {
  display: grid;
  grid-template-columns: 86px 1fr auto;
  align-items: center;
  gap: 18px;
  padding: 16px 20px;
  border-radius: 16px;
  border: 1px solid var(--borda);
  background: rgba(255, 255, 255, 0.045);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}

/* O líder ganha o roxo da casa, fosco, e um brilho contido. */
.cartao--lider {
  background:
    linear-gradient(120deg, var(--roxo-fosco), rgba(76, 141, 255, 0.14)),
    rgba(255, 255, 255, 0.05);
  border-color: rgba(154, 106, 255, 0.45);
  box-shadow: 0 14px 40px rgba(101, 21, 221, 0.28);
}

.cartao-posicao { display: flex; align-items: center; gap: 8px; }

.posicao-numero {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  border-radius: 14px;
  font-size: 21px;
  font-weight: 700;
  letter-spacing: -0.02em;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid var(--borda);
}

/* Só o pódio é colorido — do quarto em diante, o número já diz o suficiente. */
.cartao--ouro .posicao-numero {
  background: linear-gradient(145deg, #FFD976, #E0A93B);
  border-color: transparent; color: #3A2A05;
}
.cartao--prata .posicao-numero {
  background: linear-gradient(145deg, #E6EAF5, #AEB6C8);
  border-color: transparent; color: #262B36;
}
.cartao--bronze .posicao-numero {
  background: linear-gradient(145deg, #E8B08A, #B97B4E);
  border-color: transparent; color: #3A210F;
}

.posicao-mov { font-size: 12px; font-weight: 700; }
.subiu { color: #5BE49B; }
.desceu { color: #FF7A85; }

.setor-nome {
  font-size: clamp(16px, 1.9vw, 23px);
  font-weight: 650;
  letter-spacing: -0.015em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.setor-origem {
  font-size: 11px;
  color: var(--tinta-fraca);
  margin-top: 1px;
  letter-spacing: 0.02em;
}

.setor-trilho {
  height: 5px;
  border-radius: 99px;
  background: rgba(255, 255, 255, 0.08);
  margin-top: 9px;
  overflow: hidden;
}
.setor-trilho span {
  display: block;
  height: 100%;
  border-radius: 99px;
  background: linear-gradient(90deg, var(--roxo), var(--azul));
  transition: width 800ms cubic-bezier(0.22, 1, 0.36, 1);
}

.cartao-pontos { display: flex; align-items: baseline; gap: 7px; }
.pontos-numero {
  font-size: clamp(24px, 3vw, 38px);
  font-weight: 700;
  letter-spacing: -0.03em;
}
.pontos-rotulo { font-size: 12px; color: var(--tinta-fraca); }

.placar-rodape {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  justify-content: space-between;
  border-top: 1px solid var(--borda);
  margin-top: 18px;
  padding-top: 12px;
  font-size: 12px;
  color: var(--tinta-fraca);
}
.rodape-lendo { color: rgba(255, 255, 255, 0.4); }
.rodape-pendencia { color: rgba(255, 210, 120, 0.8); }

.placar-vazio,
.placar-aviso { padding: 56px 8px; text-align: center; color: var(--tinta-fraca); }
.placar-aviso { color: #FF7A85; padding: 20px 8px; }

/* ---- a ultrapassagem ---- */

/*
 * `move` é o que importa: quando a classificação muda, o cartão DESLIZA até o
 * novo lugar. Sem ela o Vue trocaria o conteúdo no lugar, e a ultrapassagem —
 * o momento que o placar existe para mostrar — passaria despercebida.
 */
.linha-move { transition: transform 800ms cubic-bezier(0.22, 1, 0.36, 1); }
.linha-enter-active { transition: opacity 420ms ease, transform 420ms ease; }
.linha-leave-active { transition: opacity 260ms ease; position: absolute; }
.linha-enter-from { opacity: 0; transform: translateY(-14px); }
.linha-leave-to { opacity: 0; }

/*
 * Quem pediu menos movimento continua lendo o placar: a ordem e os números são
 * os mesmos, só param de deslizar. A informação nunca depende da animação.
 */
@media (prefers-reduced-motion: reduce) {
  .linha-move,
  .linha-enter-active,
  .linha-leave-active,
  .setor-trilho span,
  .pilula { transition: none; }
}

@media (max-width: 720px) {
  .placar { padding: 20px 16px 14px; }
  .cartao { grid-template-columns: 62px 1fr auto; gap: 12px; padding: 13px 14px; }
  .posicao-numero { width: 38px; height: 38px; font-size: 17px; border-radius: 12px; }
}
</style>
