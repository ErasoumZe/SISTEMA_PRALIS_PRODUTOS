<script setup lang="ts">
import { VendasDatas } from '@pralis/shared';
import type { VendasRankingResposta } from '~/composables/useApi';

/**
 * Painel de setores — a tela de parede.
 *
 * É um quadro de embarque de aeroporto com setores no lugar de voos: cada
 * linha é um setor, a ordem é o ranking, e quando alguém ultrapassa outro a
 * linha SOBE — não some e reaparece. É o movimento que conta a história.
 *
 * Desenhada para ficar ligada num monitor, longe de quem olha: fundo escuro,
 * números grandes, sem nada clicável no meio do quadro.
 *
 * HONESTIDADE SOBRE "TEMPO REAL": o robô manda lote DIÁRIO. Esta tela busca
 * dado novo sozinha a cada 60 s e anima o que mudou — mas só muda quando um
 * lote chega. No dia em que o robô passar a enviar durante o expediente, o
 * painel começa a viver sem precisar de nenhuma mudança aqui. O rodapé diz a
 * hora da última leitura para ninguém confundir tela parada com loja parada.
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
  { dias: 6, label: '7 dias' },
  { dias: 29, label: '30 dias' },
] as const;
const periodo = ref<0 | 6 | 29>(0);

const inicio = computed(() => iso(VendasDatas.diasAntes(hoje, periodo.value)));
const fim = computed(() => iso(hoje));

const dados = ref<VendasRankingResposta | null>(null);
const erro = ref('');
const carregando = ref(false);
const lidoEm = ref<Date | null>(null);

/** Posição anterior de cada setor — é o que diz quem subiu e quem desceu. */
const posicaoAnterior = ref<Map<string, number>>(new Map());

async function carregar() {
  carregando.value = true;
  try {
    const r = await api.vendasRanking({
      ...(isAdmin.value ? { loja: loja.value } : {}),
      inicio: inicio.value,
      fim: fim.value,
      dimensao: 'setor',
    });
    /*
     * Guarda as posições ANTES de trocar os dados: sem isso não há como saber
     * que a Confeitaria passou a Panificação, e a seta de movimento nunca
     * apareceria.
     */
    if (dados.value) {
      posicaoAnterior.value = new Map(dados.value.itens.map((i) => [i.chave, i.posicao]));
    }
    dados.value = r;
    lidoEm.value = new Date();
    erro.value = '';
  } catch (e: unknown) {
    erro.value = (e as { data?: { message?: string } })?.data?.message
      || 'Não foi possível ler o ranking.';
  } finally {
    carregando.value = false;
  }
}

/**
 * Releitura automática.
 *
 * 60 s é folgado de propósito: a fonte muda por lote, não por venda. Bater a
 * cada segundo só gastaria banco para redesenhar o mesmo número.
 */
const INTERVALO_MS = 60_000;
let relogio: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  carregar();
  relogio = setInterval(carregar, INTERVALO_MS);
});
onBeforeUnmount(() => { if (relogio) clearInterval(relogio); });

watch([loja, periodo], carregar);

/** Quanto o setor subiu (+) ou desceu (−) desde a leitura anterior. */
const movimento = (chave: string, posicao: number): number => {
  const antes = posicaoAnterior.value.get(chave);
  return antes == null ? 0 : antes - posicao;
};

const lider = computed(() => dados.value?.itens[0] ?? null);
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pontos = (v: number) => Math.round(v).toLocaleString('pt-BR');
const hora = (d: Date | null) => (d ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—');

/**
 * Mostra dinheiro? Quem responde é a RESPOSTA, não o papel do usuário lido aqui.
 *
 * O servidor já corta o faturamento de quem não pode ver: ele chega `null`. Ler
 * `null` e esconder é mais seguro que a tela decidir por conta própria — se um
 * dia a regra do servidor mudar, a tela acompanha sozinha, sem duas verdades.
 */
const mostraDinheiro = computed(() => lider.value?.faturamento != null);

/**
 * Barra proporcional ao líder — a distância para o primeiro, de relance.
 *
 * Calculada sobre os PONTOS, não sobre o faturamento: pontos existem para todo
 * mundo, faturamento não. E a proporção é a mesma, já que uma coisa é a outra
 * vezes 25% — a barra mostra o mesmo desenho sem depender do número escondido.
 */
const fatia = (v: number) => {
  const topo = lider.value?.pontos ?? 0;
  return topo > 0 ? Math.max(2, (v / topo) * 100) : 0;
};
</script>

<template>
  <div class="painel">
    <div class="painel-topo">
      <div>
        <div class="painel-titulo">RANKING DE SETORES</div>
        <div class="painel-sub">
          {{ PERIODOS.find((p) => p.dias === periodo)?.label }} · {{ loja === 'LI' ? 'LISBOA' : 'TNP' }}
          · pontuação = faturamento × 25%
        </div>
      </div>
      <div class="d-flex align-center ga-2">
        <v-btn-toggle v-model="periodo" density="compact" variant="outlined" divided mandatory class="painel-toggle">
          <v-btn v-for="p in PERIODOS" :key="p.dias" :value="p.dias" size="small">{{ p.label }}</v-btn>
        </v-btn-toggle>
        <v-btn v-if="isAdmin" size="small" variant="outlined" class="painel-toggle" @click="loja = loja === 'TNP' ? 'LI' : 'TNP'">
          {{ loja === 'TNP' ? 'TNP' : 'LISBOA' }}
        </v-btn>
      </div>
    </div>

    <div v-if="erro" class="painel-aviso">{{ erro }}</div>

    <div v-if="!dados" class="painel-vazio">Lendo…</div>
    <div v-else-if="!dados.itens.length" class="painel-vazio">
      Nenhuma venda classificada por setor neste período.
    </div>

    <template v-else>
      <!--
        NÃO existe coluna de faturamento aqui, e não é só por estética: este
        quadro fica num monitor à vista de quem trabalha no salão, e dinheiro
        não é informação de todos. O corte é feito no SERVIDOR — a resposta
        chega sem os valores para quem não é administrador —, então não há o que
        esconder na tela. Quando o administrador abre, `mostraDinheiro` fica
        verdadeiro e a coluna aparece.
      -->
      <div class="painel-cabecalho">
        <div class="col-pos">#</div>
        <div class="col-setor">SETOR</div>
        <div v-if="mostraDinheiro" class="col-fat">FATURAMENTO</div>
        <div class="col-pts">PONTOS</div>
      </div>

      <!--
        TransitionGroup com `move`: quando a ordem muda, a linha DESLIZA até a
        nova posição em vez de sumir e reaparecer. É o que faz a ultrapassagem
        ser vista — que é o ponto inteiro do quadro.
      -->
      <TransitionGroup name="linha" tag="div" class="painel-linhas">
        <div v-for="i in dados.itens" :key="i.chave" class="linha" :class="{ 'linha-lider': i.posicao === 1 }">
          <div class="col-pos">
            <span class="pos-numero">{{ i.posicao }}</span>
            <span
              v-if="movimento(i.chave, i.posicao) !== 0"
              class="pos-mov"
              :class="movimento(i.chave, i.posicao) > 0 ? 'subiu' : 'desceu'"
            >{{ movimento(i.chave, i.posicao) > 0 ? '▲' : '▼' }}{{ Math.abs(movimento(i.chave, i.posicao)) }}</span>
          </div>
          <div class="col-setor">
            <div class="setor-nome">{{ i.rotulo }}</div>
            <div class="setor-barra"><span :style="{ width: `${fatia(i.pontos)}%` }" /></div>
          </div>
          <div v-if="mostraDinheiro" class="col-fat">{{ brl(i.faturamento ?? 0) }}</div>
          <div class="col-pts">{{ pontos(i.pontos) }}</div>
        </div>
      </TransitionGroup>

      <div class="painel-rodape">
        <span>
          Última leitura às <strong>{{ hora(lidoEm) }}</strong> · relê sozinho a cada minuto
        </span>
        <span v-if="dados.cobertura.percentual < 100" class="rodape-cobertura">
          cobre {{ dados.cobertura.percentual.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) }}%
          do faturamento — o resto ainda não casou com o cadastro
        </span>
        <span v-if="carregando" class="rodape-lendo">atualizando…</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
/*
 * Quadro de parede: fundo escuro e âmbar, como um painel de embarque. Sai do
 * tema claro do resto do sistema de propósito — esta tela é para ser vista de
 * longe, num monitor, e não para ser operada de perto.
 */
.painel {
  background: #0B0E14;
  color: #FFC947;
  border-radius: 14px;
  padding: 20px 22px 14px;
  min-height: 70vh;
  font-variant-numeric: tabular-nums;
}

.painel-topo {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  border-bottom: 1px solid rgba(255, 201, 71, 0.22);
  padding-bottom: 12px;
  margin-bottom: 14px;
}

.painel-titulo {
  font-size: clamp(20px, 3vw, 34px);
  font-weight: 800;
  letter-spacing: 0.12em;
}

.painel-sub {
  font-size: 12px;
  letter-spacing: 0.08em;
  color: rgba(255, 201, 71, 0.65);
  text-transform: uppercase;
  margin-top: 2px;
}

.painel-toggle { color: #FFC947 !important; border-color: rgba(255, 201, 71, 0.4) !important; }

.painel-cabecalho,
.linha {
  display: grid;
  grid-template-columns: 76px 1fr auto 120px;
  align-items: center;
  gap: 12px;
}

.painel-cabecalho {
  font-size: 11px;
  letter-spacing: 0.16em;
  color: rgba(255, 201, 71, 0.5);
  padding: 0 8px 8px;
}

.painel-linhas { display: flex; flex-direction: column; gap: 6px; }

.linha {
  background: rgba(255, 201, 71, 0.05);
  border-left: 3px solid rgba(255, 201, 71, 0.25);
  border-radius: 8px;
  padding: 12px 8px;
}

/* O líder é o único que muda de cor — destaque que some no dia em que ele perder. */
.linha-lider {
  background: rgba(255, 201, 71, 0.13);
  border-left-color: #FFC947;
}

.col-pos { display: flex; align-items: baseline; gap: 6px; padding-left: 8px; }
.pos-numero { font-size: clamp(20px, 2.4vw, 30px); font-weight: 800; }
.pos-mov { font-size: 11px; font-weight: 700; }
.subiu { color: #4ADE80; }
.desceu { color: #F87171; }

.setor-nome {
  font-size: clamp(15px, 1.8vw, 22px);
  font-weight: 700;
  letter-spacing: 0.04em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.setor-barra { height: 4px; background: rgba(255, 201, 71, 0.12); border-radius: 2px; margin-top: 6px; }
.setor-barra span {
  display: block;
  height: 100%;
  background: #FFC947;
  border-radius: 2px;
  transition: width 700ms cubic-bezier(0.22, 1, 0.36, 1);
}

.col-fat { font-size: clamp(15px, 1.8vw, 22px); font-weight: 700; text-align: right; }
.col-pts {
  font-size: clamp(17px, 2vw, 26px);
  font-weight: 800;
  text-align: right;
  padding-right: 8px;
  color: #FFFFFF;
}

.painel-rodape {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  justify-content: space-between;
  border-top: 1px solid rgba(255, 201, 71, 0.18);
  margin-top: 14px;
  padding-top: 10px;
  font-size: 12px;
  color: rgba(255, 201, 71, 0.6);
}
.rodape-cobertura { color: #F8B44C; }
.rodape-lendo { color: rgba(255, 255, 255, 0.55); }

.painel-vazio,
.painel-aviso {
  padding: 48px 8px;
  text-align: center;
  color: rgba(255, 201, 71, 0.6);
  letter-spacing: 0.08em;
}
.painel-aviso { color: #F87171; padding: 16px 8px; }

/* ---- a animação da ultrapassagem ---- */

/*
 * `move` é o que importa: quando a ordem do ranking muda, a linha desliza até
 * o novo lugar. Sem ela o Vue trocaria o conteúdo no lugar, e uma ultrapassagem
 * — o momento que o quadro existe para mostrar — passaria despercebida.
 */
.linha-move { transition: transform 700ms cubic-bezier(0.22, 1, 0.36, 1); }
.linha-enter-active { transition: opacity 400ms ease, transform 400ms ease; }
.linha-leave-active { transition: opacity 250ms ease; position: absolute; }
.linha-enter-from { opacity: 0; transform: translateY(-12px); }
.linha-leave-to { opacity: 0; }

/*
 * Quem pediu menos movimento continua lendo o quadro: a ordem e os números são
 * os mesmos, só param de deslizar. A informação nunca depende da animação.
 */
@media (prefers-reduced-motion: reduce) {
  .linha-move,
  .linha-enter-active,
  .linha-leave-active,
  .setor-barra span { transition: none; }
}

@media (max-width: 720px) {
  .painel-cabecalho,
  .linha { grid-template-columns: 56px 1fr 110px; }
  .col-pts { display: none; }
}
</style>
