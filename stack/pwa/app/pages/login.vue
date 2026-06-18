<script setup lang="ts">
const { login, register, verify, resend } = useAuth();

const modo = ref<'login' | 'registro' | 'verificar'>('login');
const name = ref('');
const email = ref('');
const password = ref('');
const loja = ref<'TNP' | 'LI' | 'HORA' | null>(null);
const code = ref('');
const loading = ref(false);
const erro = ref('');
const aviso = ref('');

async function submit() {
  erro.value = '';
  aviso.value = '';
  if (modo.value === 'registro' && !loja.value) {
    erro.value = 'Selecione a sua loja.';
    return;
  }
  loading.value = true;
  try {
    if (modo.value === 'login') {
      await login(email.value, password.value);
      await navigateTo('/');
    } else if (modo.value === 'registro') {
      await register(name.value, email.value, password.value, loja.value!);
      modo.value = 'verificar';
      aviso.value = `Enviamos um código de 6 dígitos para ${email.value}. Digite-o abaixo.`;
    } else {
      await verify(email.value, code.value);
      await navigateTo('/');
    }
  } catch (e: unknown) {
    const err = e as { data?: { message?: string; details?: { code?: string } } };
    // login com e-mail não confirmado → vai pra etapa de verificação
    if (err?.data?.details?.code === 'EMAIL_NOT_VERIFIED') {
      await resend(email.value).catch(() => {});
      modo.value = 'verificar';
      aviso.value = `Sua conta ainda não foi confirmada. Enviamos um novo código para ${email.value}.`;
    } else {
      erro.value = err?.data?.message || 'Falha. Confira os dados.';
    }
  } finally {
    loading.value = false;
  }
}

async function reenviar() {
  erro.value = '';
  await resend(email.value).catch(() => {});
  aviso.value = `Novo código enviado para ${email.value}.`;
}

const titulo = computed(() =>
  modo.value === 'login' ? 'Entre na sua conta' : modo.value === 'registro' ? 'Crie sua conta' : 'Confirme seu e-mail',
);
const botao = computed(() =>
  modo.value === 'login' ? 'Entrar' : modo.value === 'registro' ? 'Criar conta' : 'Confirmar',
);
</script>

<template>
  <v-row justify="center" class="mt-8">
    <v-col cols="12" sm="8" md="5" lg="4">
      <v-card flat border rounded="lg" class="pa-2">
        <v-card-item class="text-center">
          <v-icon color="primary" size="40">mdi-package-variant-closed</v-icon>
          <div class="text-h6 font-weight-bold mt-2">Cadastro de Produtos — Pralis</div>
          <div class="text-body-2 text-medium-emphasis">{{ titulo }}</div>
        </v-card-item>

        <v-card-text>
          <v-alert v-if="erro" type="error" variant="tonal" density="compact" class="mb-3">{{ erro }}</v-alert>
          <v-alert v-if="aviso" type="info" variant="tonal" density="compact" class="mb-3">{{ aviso }}</v-alert>

          <v-form @submit.prevent="submit">
            <!-- etapa de confirmação por código -->
            <template v-if="modo === 'verificar'">
              <v-text-field
                v-model="code"
                label="Código (6 dígitos)"
                variant="outlined"
                density="comfortable"
                prepend-inner-icon="mdi-shield-key"
                maxlength="6"
                class="mb-2"
              />
              <v-btn type="submit" color="primary" block size="large" :loading="loading">Confirmar</v-btn>
              <div class="text-center mt-3 text-body-2">
                <a href="#" class="text-primary text-decoration-none" @click.prevent="reenviar">Reenviar código</a>
              </div>
            </template>

            <!-- login / registro -->
            <template v-else>
              <v-text-field
                v-if="modo === 'registro'"
                v-model="name"
                label="Nome"
                variant="outlined"
                density="comfortable"
                prepend-inner-icon="mdi-account"
                class="mb-2"
              />
              <v-select
                v-if="modo === 'registro'"
                v-model="loja"
                :items="['TNP', 'LI', 'HORA']"
                label="Sua loja"
                variant="outlined"
                density="comfortable"
                prepend-inner-icon="mdi-store"
                class="mb-2"
              />
              <v-text-field v-model="email" label="E-mail" type="email" variant="outlined" density="comfortable" prepend-inner-icon="mdi-email" class="mb-2" />
              <v-text-field v-model="password" label="Senha" type="password" variant="outlined" density="comfortable" prepend-inner-icon="mdi-lock" class="mb-2" />
              <v-btn type="submit" color="primary" block size="large" :loading="loading">{{ botao }}</v-btn>
            </template>
          </v-form>

          <div v-if="modo !== 'verificar'" class="text-center mt-4 text-body-2">
            <a href="#" class="text-primary text-decoration-none" @click.prevent="modo = modo === 'login' ? 'registro' : 'login'">
              {{ modo === 'login' ? 'Não tem conta? Criar uma' : 'Já tem conta? Entrar' }}
            </a>
          </div>
        </v-card-text>
      </v-card>
    </v-col>
  </v-row>
</template>
