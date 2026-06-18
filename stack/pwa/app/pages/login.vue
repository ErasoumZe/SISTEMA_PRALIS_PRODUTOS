<script setup lang="ts">
const { login, register } = useAuth();

const modo = ref<'login' | 'registro'>('login');
const name = ref('');
const email = ref('');
const password = ref('');
const loading = ref(false);
const erro = ref('');

async function submit() {
  erro.value = '';
  loading.value = true;
  try {
    if (modo.value === 'login') await login(email.value, password.value);
    else await register(name.value, email.value, password.value);
    await navigateTo('/');
  } catch (e: unknown) {
    erro.value = (e as { data?: { message?: string } })?.data?.message || 'Falha. Confira os dados.';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <v-row justify="center" class="mt-8">
    <v-col cols="12" sm="8" md="5" lg="4">
      <v-card flat border rounded="lg" class="pa-2">
        <v-card-item class="text-center">
          <v-icon color="primary" size="40">mdi-package-variant-closed</v-icon>
          <div class="text-h6 font-weight-bold mt-2">Cadastro de Produtos — Pralis</div>
          <div class="text-body-2 text-medium-emphasis">
            {{ modo === 'login' ? 'Entre na sua conta' : 'Crie sua conta' }}
          </div>
        </v-card-item>

        <v-card-text>
          <v-alert v-if="erro" type="error" variant="tonal" density="compact" class="mb-3">{{ erro }}</v-alert>

          <v-form @submit.prevent="submit">
            <v-text-field
              v-if="modo === 'registro'"
              v-model="name"
              label="Nome"
              variant="outlined"
              density="comfortable"
              prepend-inner-icon="mdi-account"
              class="mb-2"
            />
            <v-text-field
              v-model="email"
              label="E-mail"
              type="email"
              variant="outlined"
              density="comfortable"
              prepend-inner-icon="mdi-email"
              class="mb-2"
            />
            <v-text-field
              v-model="password"
              label="Senha"
              type="password"
              variant="outlined"
              density="comfortable"
              prepend-inner-icon="mdi-lock"
              class="mb-2"
            />
            <v-btn type="submit" color="primary" block size="large" :loading="loading">
              {{ modo === 'login' ? 'Entrar' : 'Criar conta' }}
            </v-btn>
          </v-form>

          <div class="text-center mt-4 text-body-2">
            <a href="#" class="text-primary text-decoration-none" @click.prevent="modo = modo === 'login' ? 'registro' : 'login'">
              {{ modo === 'login' ? 'Não tem conta? Criar uma' : 'Já tem conta? Entrar' }}
            </a>
          </div>
        </v-card-text>
      </v-card>
    </v-col>
  </v-row>
</template>
