<script setup lang="ts">
import type { PainelDePermissoes, PessoaPermissao } from '~/composables/useApi';

/**
 * Quem enxerga cada tela.
 *
 * Uma linha por pessoa, uma coluna por tela, um toggle em cada cruzamento —
 * roxo ligado, cinza desligado. A grade é a forma honesta para esta pergunta:
 * a dúvida real nunca é "o que a Giulia vê?" isolada, e sim "quem mais vê
 * Manutenção?" — e isso só se responde olhando uma coluna inteira.
 *
 * O servidor decide tudo: quem pode mexer em quem, e o que a pessoa passa a
 * enxergar. Esta tela não recalcula regra nenhuma — ela mostra `gerenciavel` e
 * `motivo` como vieram, e regrava o que o servidor devolve.
 */
const api = useApi();
const flash = useFlash();
const { user, fetchMe } = useAuth();

const dados = ref<PainelDePermissoes | null>(null);
const carregando = ref(false);
const erro = ref('');
/** Qual cruzamento está gravando — trava só aquele toggle, não a grade inteira. */
const gravando = ref<string | null>(null);
const busca = ref('');
const soAdministracao = ref(false);

const chave = (userId: string, telaId: string) => `${userId}:${telaId}`;

const telasVisiveis = computed(() => {
  const todas = dados.value?.telas ?? [];
  return soAdministracao.value ? todas.filter((t) => t.secao === 'Administração') : todas;
});

const pessoasVisiveis = computed(() => {
  const termo = busca.value.trim().toLowerCase();
  const lista = dados.value?.pessoas ?? [];
  if (!termo) return lista;
  return lista.filter((p) => p.nome.toLowerCase().includes(termo)
    || p.email.toLowerCase().includes(termo));
});

const temAcesso = (pessoa: PessoaPermissao, telaId: string) => pessoa.telas.includes(telaId);

const sempreLiberada = (telaId: string) => (dados.value?.sempreLiberadas ?? []).includes(telaId);

/** Por que este toggle está travado — vira o `title` do cruzamento. */
function motivoDoBloqueio(pessoa: PessoaPermissao, telaId: string): string {
  if (pessoa.adminRaiz) return 'O administrador principal enxerga todas as telas.';
  if (!pessoa.gerenciavel) return pessoa.motivo ?? 'Você não pode alterar esta pessoa.';
  if (sempreLiberada(telaId)) return 'Esta tela não pode ser desligada de ninguém.';
  return '';
}

const travado = (pessoa: PessoaPermissao, telaId: string) =>
  pessoa.adminRaiz || !pessoa.gerenciavel || sempreLiberada(telaId);

async function carregar() {
  carregando.value = true;
  erro.value = '';
  try {
    dados.value = await api.permissoesPainel();
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
  gravando.value = chave(pessoa.userId, telaId);
  try {
    const r = await api.permissoesAlternar({ userId: pessoa.userId, telaId, permitido });
    // o servidor devolve a lista final: nada de adivinhar aqui o resultado
    pessoa.telas = r.telas;
    const tela = dados.value?.telas.find((t) => t.id === telaId);
    flash.value = {
      texto: `${pessoa.nome}: "${tela?.titulo ?? telaId}" ${permitido ? 'liberada' : 'bloqueada'}.`,
      tipo: 'success',
    };
    // mexeu em si mesmo é impossível, mas o menu de quem olha pode ter mudado
    // por outra via (outro admin numa aba); reler é barato e evita menu velho
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

const quantasTem = (pessoa: PessoaPermissao) =>
  telasVisiveis.value.filter((t) => temAcesso(pessoa, t.id)).length;
</script>

<template>
  <div>
    <v-alert v-if="erro" type="error" variant="tonal" class="mb-4">{{ erro }}</v-alert>

    <v-card v-if="dados" flat border rounded="lg" class="pa-4 mb-4">
      <div class="d-flex flex-wrap align-center ga-3">
        <v-text-field
          v-model="busca"
          label="Buscar pessoa"
          density="compact"
          variant="outlined"
          hide-details
          clearable
          prepend-inner-icon="search"
          style="max-width: 320px"
        />
        <v-switch
          v-model="soAdministracao"
          color="primary"
          density="compact"
          hide-details
          label="Só telas de administração"
        />
        <v-spacer />
        <span class="text-caption text-medium-emphasis">
          Roxo = enxerga · Cinza = não enxerga
        </span>
      </div>
    </v-card>

    <v-card flat border rounded="lg">
      <v-progress-linear v-if="carregando" indeterminate color="primary" />

      <!--
        A grade rola na horizontal dentro do próprio contêiner: são muitas
        colunas, e deixar a PÁGINA rolar de lado tiraria a coluna do nome da
        vista justamente quando ela é a referência de qual linha se está lendo.
      -->
      <div v-if="dados" class="grade">
        <table>
          <thead>
            <tr>
              <th class="pessoa">Pessoa</th>
              <th v-for="t in telasVisiveis" :key="t.id" class="tela">
                <span :title="t.subtitulo">{{ t.titulo }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in pessoasVisiveis" :key="p.userId">
              <td class="pessoa">
                <div class="d-flex align-center ga-2">
                  <span class="font-weight-medium">{{ p.nome }}</span>
                  <v-chip v-if="p.adminRaiz" size="x-small" color="primary" variant="flat">
                    admin principal
                  </v-chip>
                  <v-chip v-else-if="p.role === 'admin'" size="x-small" variant="tonal">admin</v-chip>
                  <v-chip v-if="p.loja" size="x-small" variant="text">{{ p.loja }}</v-chip>
                  <v-chip v-if="!p.ativo" size="x-small" color="warning" variant="tonal">inativo</v-chip>
                </div>
                <div class="text-caption text-medium-emphasis">
                  {{ p.email }} · {{ quantasTem(p) }} de {{ telasVisiveis.length }}
                </div>
                <div v-if="!p.gerenciavel && p.motivo" class="text-caption text-warning">
                  {{ p.motivo }}
                </div>
              </td>

              <td v-for="t in telasVisiveis" :key="t.id" class="marca">
                <v-switch
                  :model-value="temAcesso(p, t.id)"
                  color="primary"
                  density="compact"
                  hide-details
                  inset
                  :disabled="travado(p, t.id)"
                  :loading="gravando === chave(p.userId, t.id)"
                  :title="motivoDoBloqueio(p, t.id) || `${p.nome} · ${t.titulo}`"
                  @update:model-value="alternar(p, t.id)"
                />
              </td>
            </tr>
            <tr v-if="pessoasVisiveis.length === 0">
              <td :colspan="telasVisiveis.length + 1" class="pa-6 text-center text-medium-emphasis">
                {{ busca ? 'Nenhuma pessoa com esse termo.' : 'Nenhuma pessoa cadastrada.' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </v-card>
  </div>
</template>

<style scoped>
.grade {
  overflow-x: auto;
}

table {
  border-collapse: collapse;
  width: max-content;
  min-width: 100%;
}

th,
td {
  border-bottom: 1px solid rgb(var(--v-border-color), var(--v-border-opacity));
  padding: 8px 12px;
  vertical-align: middle;
}

/*
 * A coluna do nome fica presa à esquerda: rolando para ver a vigésima tela,
 * sem isso não dá para saber de quem é a linha.
 */
th.pessoa,
td.pessoa {
  position: sticky;
  left: 0;
  z-index: 1;
  background: rgb(var(--v-theme-surface));
  min-width: 260px;
  text-align: left;
}

th.tela {
  /* Nomes de tela são longos e as colunas, estreitas: na vertical cabem sem
     abreviar, e abreviar aqui trocaria "Manutenção do catálogo" por algo que
     ninguém reconhece na hora de decidir. */
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  height: 170px;
  font-weight: 500;
  white-space: nowrap;
  padding: 12px 4px;
}

td.marca {
  text-align: center;
}

td.marca :deep(.v-selection-control) {
  justify-content: center;
}
</style>
