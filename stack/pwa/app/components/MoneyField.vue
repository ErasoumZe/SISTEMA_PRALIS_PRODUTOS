<script setup lang="ts">
import { Money } from '@pralis/shared';

/**
 * Campo de dinheiro: sempre duas casas.
 *
 * Não usa `type="number"` de propósito — o navegador normaliza `0,10` para
 * `0.1` e come a segunda casa, que é exatamente o problema. Aqui o valor é
 * texto na tela e número no modelo, e a formatação acontece ao sair do campo
 * para não atrapalhar quem está digitando.
 *
 * O formato e a leitura vêm do contrato compartilhado (`Money`), então tela e
 * servidor concordam sobre o que é R$ 0,10.
 */
const props = defineProps<{
  modelValue: number | null;
  label: string;
  disabled?: boolean;
  hint?: string;
  errorMessages?: string | string[];
}>();

const emit = defineEmits<{ 'update:modelValue': [number | null] }>();

const texto = ref(Money.formatarMoeda(props.modelValue));
/** Enquanto a pessoa digita, o pai não pode reescrever o que ela está escrevendo. */
const digitando = ref(false);

watch(
  () => props.modelValue,
  (v) => { if (!digitando.value) texto.value = Money.formatarMoeda(v); },
);

function aoDigitar(valor: string) {
  digitando.value = true;
  texto.value = valor;
  emit('update:modelValue', Money.parseMoeda(valor));
}

function aoSair() {
  digitando.value = false;
  const numero = Money.parseMoeda(texto.value);
  texto.value = Money.formatarMoeda(numero); // 0,1 -> 0,10
  emit('update:modelValue', numero);
}
</script>

<template>
  <v-text-field
    :model-value="texto"
    :label="label"
    :disabled="disabled"
    :hint="hint"
    :error-messages="errorMessages"
    variant="outlined"
    density="comfortable"
    inputmode="decimal"
    prefix="R$"
    @update:model-value="aoDigitar"
    @blur="aoSair"
  />
</template>
