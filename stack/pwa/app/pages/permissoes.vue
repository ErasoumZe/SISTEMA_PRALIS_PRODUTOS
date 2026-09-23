<script setup lang="ts">
import { useDisplay } from 'vuetify';
import type { PainelDePermissoes, PessoaPermissao } from '~/composables/useApi';

/**
 * Quem enxerga cada tela.
 *
 * A primeira versão era uma GRADE — pessoas nas linhas, 19 telas nas colunas.
 * Ela respondia bem "quem mais vê Manutenção?", e respondia mal tudo o mais:
 * com 19 colunas os títulos só cabiam deitados, e ler um nome de tela de lado
 * para decidir sobre acesso é o tipo de esforço que faz a pessoa clicar no
 * cruzamento errado.
 *
 * Agora é uma coisa de cada vez: escolhe-se a PESSOA à esquerda e se decide as
 * telas dela à direita, agrupadas pela mesma seção do menu. Some a leitura
 * cruzada, mas a pergunta que se faz aqui de verdade é "o que o fulano pode
 * ver?", e essa agora tem uma tela inteira para ela.
 */
const api = useApi();
const flash = useFlash();
const { user, fetchMe } = useAuth();
const { mdAndUp } = useDisplay();

const dados = ref<PainelDePermissoes | null>(null);
const carregando = ref(false);
const erro = ref('');
/** Qual tela está gravando — trava só aquele switch, não a lista inteira. */
const gravando = ref<string | null>(null);
const busca = ref('');
const selecionadoId = ref<string | null>(null);

const pessoas = computed(() => dados.value?.pessoas ?? []);

const pessoasFiltradas = computed(() => {
  const termo = busca.value.trim().toLowerCase();
  if (!termo) return pessoas.value;
  return pessoas.value.filter((p) => p.nome.toLowerCase().includes(termo)
    || p.email.toLowerCase().includes(termo));
});

const selecionado = computed<PessoaPermissao | null>(() =>
  pessoas.value.find((p) => p.userId === selecionadoId.value) ?? null);

/** As telas da pessoa escolhida, na ordem e nos grupos do menu. */
const grupos = computed(() => {
  if (!dados.value) return [];
  return dados.value.secoes
    .map((secao) => ({
      secao,
      telas: dados.value!.telas.filter((t) => t.secao === secao),
    }))
    .filter((g) => g.telas.length > 0);
});

const temAcesso = (pessoa: PessoaPermissao, telaId: string) => pessoa.telas.includes(telaId);
const sempreLiberada = (telaId: string) => (dados.value?.sempreLiberadas ?? []).includes(telaId);

const travado = (pessoa: PessoaPermissao, telaId: string) =>
  pessoa.adminRaiz || !pessoa.gerenciavel || sempreLiberada(telaId);

/** Por que este switch não responde — vira a legenda embaixo da linha. */
function motivoDoBloqueio(pessoa: PessoaPermissao, telaId: string): string {
  if (pessoa.adminRaiz || !pessoa.gerenciavel) return '';
  return sempreLiberada(telaId) ? 'Sempre liberada' : '';
}

const iniciais = (nome: string) => nome
  .split(' ')
  .filter(Boolean)
  .map((p) => p[0])
  .slice(0, 2)
  .join('')
  .toUpperCase();

const total = computed(() => dados.value?.telas.length ?? 0);
const quantasTem = (pessoa: PessoaPermissao) =>
  (dados.value?.telas ?? []).filter((t) => temAcesso(pessoa, t.id)).length;

async function carregar() {
  carregando.value = true;
  erro.value = '';
  try {
    dados.value = await api.permissoesPainel();
    // abre já com alguém aberto: tela vazia não ensina o que ela faz
    if (!selecionado.value) {
      selecionadoId.value = dados.value.pessoas.find((p) => p.gerenciavel)?.userId
        ?? dados.value.pessoas[0]?.userId
        ?? null;
    }
  } catch (e: unknown) {
    dados.value = null;
    erro.value = (e as { data?: { message?: string } })?.data?.message
      || 'Não foi possível carregar as permissões.';
  } finally {
    carregando.value = false;
  }
}

onMounted(() => { void carregar(); });

async function alternar(pessoa: PessoaPermissao, telaId: string) {
  if (travado(pessoa, telaId) || gravando.value) return;
  const permitido = !temAcesso(pessoa, telaId);
  gravando.value = telaId;
  try {
    const r = await api.permissoesAlternar({ userId: pessoa.userId, telaId, permitido });
    // o servidor devolve a lista final: nada de adivinhar aqui o resultado
    pessoa.telas = r.telas;
    const tela = dados.value?.telas.find((t) => t.id === telaId);
    flash.value = {
      texto: `${pessoa.nome}: "${tela?.titulo ?? telaId}" ${permitido ? 'liberada' : 'bloqueada'}.`,
      tipo: 'success',
    };
    if (pessoa.userId === user.value?.id) await fetchMe();
  } catch (e: unknown) {
    flash.value = {
      texto: (e as { data?: { message?: string } })?.data?.message || 'Não foi possível alterar.',
      tipo: 'error',
    };
  } finally {
    gravando.value = null;
  }
}

/** No celular, a lista e o detalhe não cabem lado a lado: um de cada vez. */
const mostrandoDetalhe = ref(false);
function escolher(p: PessoaPermissao) {
  selecionadoId.value = p.userId;
  mostrandoDetalhe.value = true;
}
const verLista = computed(() => mdAndUp.value || !mostrandoDetalhe.value);
const verDetalhe = computed(() => mdAndUp.value || mostrandoDetalhe.value);
</script>

<template>
  <div class="permissoes">
    <v-alert v-if="erro" type="error" variant="tonal" class="mb-4">{{ erro }}</v-alert>
    <v-progress-linear v-if="carregando" indeterminate color="primary" class="mb-4" rounded />

    <div v-if="dados" class="palco">
      <!-- PESSOAS -->
      <aside v-show="verLista" class="coluna-pessoas">
        <div class="campo-busca">
          <v-icon size="18" class="lupa">search</v-icon>
          <input v-model="busca" type="text" placeholder="Buscar pessoa" spellcheck="false">
          <button v-if="busca" class="limpar" type="button" @click="busca = ''">
            <v-icon size="16">close</v-icon>
          </button>
        </div>

        <ul class="lista">
          <li v-for="p in pessoasFiltradas" :key="p.userId">
            <button
              type="button"
              class="pessoa"
              :class="{ ativa: p.userId === selecionadoId }"
              @click="escolher(p)"
            >
              <span class="avatar" :class="{ raiz: p.adminRaiz }">{{ iniciais(p.nome) }}</span>
              <span class="dados">
                <span class="linha-nome">
                  <span class="nome">{{ p.nome }}</span>
                  <span v-if="p.adminRaiz" class="selo principal">principal</span>
                  <span v-else-if="p.role === 'admin'" class="selo">admin</span>
                </span>
                <span class="email">{{ p.email }}</span>
              </span>
              <span class="contagem">{{ quantasTem(p) }}<span class="de">/{{ total }}</span></span>
            </button>
          </li>
          <li v-if="pessoasFiltradas.length === 0" class="vazio">
            Nenhuma pessoa com esse termo.
          </li>
        </ul>
      </aside>

      <!-- TELAS DA PESSOA -->
      <section v-show="verDetalhe" class="coluna-telas">
        <template v-if="selecionado">
          <header class="cabecalho">
            <button
              v-if="!mdAndUp"
              type="button"
              class="voltar"
              @click="mostrandoDetalhe = false"
            >
              <v-icon size="18">arrow_back</v-icon> Pessoas
            </button>

            <div class="identidade">
              <span class="avatar grande" :class="{ raiz: selecionado.adminRaiz }">
                {{ iniciais(selecionado.nome) }}
              </span>
              <div>
                <h2>{{ selecionado.nome }}</h2>
                <p class="email">{{ selecionado.email }}</p>
                <div class="marcas">
                  <span v-if="selecionado.adminRaiz" class="selo principal">admin principal</span>
                  <span v-else-if="selecionado.role === 'admin'" class="selo">admin</span>
                  <span v-if="selecionado.loja" class="selo">{{ selecionado.loja }}</span>
                  <span v-if="!selecionado.ativo" class="selo inativo">inativo</span>
                </div>
              </div>
              <div class="resumo">
                <strong>{{ quantasTem(selecionado) }}</strong>
                <span>de {{ total }} telas</span>
              </div>
            </div>

            <p v-if="!selecionado.gerenciavel" class="aviso">
              <v-icon size="16">lock</v-icon>
              {{ selecionado.motivo }}
            </p>
          </header>

          <div v-for="g in grupos" :key="g.secao" class="grupo">
            <h3>{{ g.secao }}</h3>
            <div class="cartao">
              <div
                v-for="t in g.telas"
                :key="t.id"
                class="linha"
                :class="{ travada: travado(selecionado, t.id) }"
              >
                <span class="icone"><v-icon size="20">{{ t.icone }}</v-icon></span>
                <span class="texto">
                  <span class="titulo">{{ t.titulo }}</span>
                  <span class="sub">{{ motivoDoBloqueio(selecionado, t.id) || t.subtitulo }}</span>
                </span>
                <v-switch
                  :model-value="temAcesso(selecionado, t.id)"
                  color="primary"
                  density="compact"
                  hide-details
                  inset
                  :disabled="travado(selecionado, t.id)"
                  :loading="gravando === t.id"
                  @update:model-value="alternar(selecionado, t.id)"
                />
              </div>
            </div>
          </div>
        </template>

        <p v-else class="nenhuma">Escolha uma pessoa para ver as telas dela.</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
/*
 * Paleta e medidas vêm dos tokens do Vuetify (`--v-theme-*`), não de hex
 * fixo: esta tela vive dentro do app e precisa acompanhar o tema claro e o
 * escuro sem manter uma segunda paleta que envelhece sozinha.
 */
.permissoes {
  --fio: rgba(var(--v-theme-on-surface), 0.08);
  --fundo: rgba(var(--v-theme-on-surface), 0.025);
  --secundario: rgba(var(--v-theme-on-surface), 0.6);
  --raio: 14px;
}

.palco {
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}

@media (max-width: 959px) {
  .palco {
    grid-template-columns: minmax(0, 1fr);
  }
}

/* ---------- coluna das pessoas ---------- */

.coluna-pessoas {
  position: sticky;
  top: 16px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid var(--fio);
  border-radius: var(--raio);
  overflow: hidden;
}

@media (max-width: 959px) {
  .coluna-pessoas {
    position: static;
  }
}

.campo-busca {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--fio);
  background: var(--fundo);
}

.campo-busca input {
  flex: 1;
  border: 0;
  outline: none;
  background: transparent;
  font-size: 0.9375rem;
  color: rgb(var(--v-theme-on-surface));
  min-width: 0;
}

.campo-busca .lupa,
.campo-busca .limpar {
  color: var(--secundario);
}

.campo-busca .limpar {
  border: 0;
  background: transparent;
  cursor: pointer;
  display: flex;
  padding: 2px;
}

.lista {
  list-style: none;
  margin: 0;
  padding: 6px;
  max-height: calc(100vh - 220px);
  overflow-y: auto;
}

@media (max-width: 959px) {
  .lista {
    max-height: none;
  }
}

.pessoa {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease;
}

.pessoa:hover {
  background: var(--fundo);
}

.pessoa.ativa {
  background: rgba(var(--v-theme-primary), 0.1);
}

.pessoa:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: -2px;
}

.avatar {
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: var(--secundario);
}

.avatar.raiz {
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}

.avatar.grande {
  width: 52px;
  height: 52px;
  font-size: 1rem;
}

.dados {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.linha-nome {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.nome {
  font-size: 0.9375rem;
  font-weight: 550;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.email {
  font-size: 0.8125rem;
  color: var(--secundario);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.contagem {
  flex: none;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--secundario);
  font-variant-numeric: tabular-nums;
}

.contagem .de {
  font-weight: 400;
  opacity: 0.6;
}

.selo {
  flex: none;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: var(--secundario);
  white-space: nowrap;
}

.selo.principal {
  background: rgba(var(--v-theme-primary), 0.14);
  color: rgb(var(--v-theme-primary));
}

.selo.inativo {
  background: rgba(var(--v-theme-warning), 0.16);
  color: rgb(var(--v-theme-warning));
}

.vazio {
  padding: 24px 12px;
  text-align: center;
  font-size: 0.875rem;
  color: var(--secundario);
}

/* ---------- coluna das telas ---------- */

.coluna-telas {
  max-width: 680px;
}

.voltar {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 0;
  background: transparent;
  color: rgb(var(--v-theme-primary));
  font-size: 0.9375rem;
  cursor: pointer;
  padding: 0 0 12px;
}

.cabecalho {
  margin-bottom: 28px;
}

.identidade {
  display: flex;
  align-items: center;
  gap: 16px;
}

.identidade h2 {
  font-size: 1.375rem;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.01em;
}

.identidade .email {
  font-size: 0.875rem;
  margin-top: 2px;
}

.marcas {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.resumo {
  margin-left: auto;
  text-align: right;
  line-height: 1.1;
}

.resumo strong {
  display: block;
  font-size: 1.75rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}

.resumo span {
  font-size: 0.75rem;
  color: var(--secundario);
}

.aviso {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 16px;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(var(--v-theme-warning), 0.1);
  color: rgb(var(--v-theme-warning));
  font-size: 0.8125rem;
}

.grupo {
  margin-bottom: 24px;
}

.grupo h3 {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--secundario);
  padding: 0 4px 8px;
}

.cartao {
  background: rgb(var(--v-theme-surface));
  border: 1px solid var(--fio);
  border-radius: var(--raio);
  overflow: hidden;
}

.linha {
  position: relative;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
}

/*
 * O fio separador começa DEPOIS do ícone, como nas listas agrupadas do iOS:
 * assim o ícone ancora a coluna e as linhas se leem como um bloco só, em vez
 * de fatias empilhadas. Por isso é pseudo-elemento recuado, e não `border-top`
 * na linha inteira — e por isso ele não aparece na primeira.
 */
.linha + .linha::before {
  content: '';
  position: absolute;
  top: 0;
  left: 62px; /* 16 do padding + 32 do ícone + 14 do gap */
  right: 0;
  border-top: 1px solid var(--fio);
}

.linha.travada {
  opacity: 0.55;
}

.icone {
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: var(--secundario);
}

.texto {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.texto .titulo {
  font-size: 0.9375rem;
  font-weight: 500;
}

.texto .sub {
  font-size: 0.8125rem;
  color: var(--secundario);
}

.linha :deep(.v-switch) {
  flex: none;
}

.nenhuma {
  padding: 48px 0;
  text-align: center;
  color: var(--secundario);
}
</style>
