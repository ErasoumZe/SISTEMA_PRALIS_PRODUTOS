<script setup lang="ts">
definePageMeta({ layout: 'auth' });

const { login, register, verify, resend } = useAuth();
const adminEmail = (useRuntimeConfig().public.adminEmail as string).toLowerCase();
const brandLogo = '/brand/simbolo.png';

const modo = ref<'login' | 'registro' | 'verificar'>('login');
const name = ref('');
const email = ref('');
const password = ref('');
const loja = ref<'TNP' | 'LI' | 'HORA' | null>(null);
const code = ref('');
const loading = ref(false);
const erro = ref('');
const aviso = ref('');

// admin principal não escolhe loja (casa = catálogo Base)
const ehAdmin = computed(() => email.value.trim().toLowerCase() === adminEmail);

async function submit() {
  erro.value = '';
  aviso.value = '';
  if (modo.value === 'registro' && !ehAdmin.value && !loja.value) {
    erro.value = 'Selecione a sua loja.';
    return;
  }
  loading.value = true;
  try {
    if (modo.value === 'login') {
      await login(email.value, password.value);
      await navigateTo('/');
    } else if (modo.value === 'registro') {
      await register(name.value, email.value, password.value, ehAdmin.value ? undefined : loja.value!);
      modo.value = 'verificar';
      aviso.value = `Enviamos um código de 6 dígitos para ${email.value}. Digite-o abaixo.`;
    } else {
      await verify(email.value, code.value);
      await navigateTo('/');
    }
  } catch (e: unknown) {
    const err = e as { data?: { message?: string; details?: { code?: string } } };
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
  modo.value === 'login' ? 'Bem-vindo de volta' : modo.value === 'registro' ? 'Crie sua conta' : 'Confirme seu e-mail',
);
const subtitulo = computed(() =>
  modo.value === 'login'
    ? 'Entre para gerenciar os produtos da sua loja'
    : modo.value === 'registro'
      ? 'Preencha seus dados para começar'
      : 'Digite o código que enviamos por e-mail',
);
const botao = computed(() =>
  modo.value === 'login' ? 'Entrar' : modo.value === 'registro' ? 'Criar conta' : 'Confirmar',
);
</script>

<template>
  <div class="d-flex align-center justify-center pa-4" style="min-height: 100vh">
    <v-card width="440" max-width="100%" rounded="xl" elevation="12" class="pa-2">
      <v-card-text class="pa-8">
        <div class="text-center mb-6">
          <v-avatar
            color="primary"
            size="64"
            class="mb-3"
            style="border-radius: 20px; box-shadow: 0 8px 22px rgba(92, 58, 52, 0.35)"
          >
            <v-img :src="brandLogo" cover>
              <template #error>
                <v-icon size="32" color="white">storefront</v-icon>
              </template>
            </v-img>
          </v-avatar>
          <div class="text-overline text-medium-emphasis">CADASTRO DE PRODUTOS — PRALIS</div>
          <div class="text-h5 font-weight-bold mt-1">{{ titulo }}</div>
          <div class="text-body-2 text-medium-emphasis">{{ subtitulo }}</div>
        </div>

        <v-alert v-if="erro" type="error" variant="tonal" density="compact" class="mb-4">{{ erro }}</v-alert>
        <v-alert v-if="aviso" type="info" variant="tonal" density="compact" class="mb-4">{{ aviso }}</v-alert>

        <v-form @submit.prevent="submit">
          <template v-if="modo === 'verificar'">
            <v-text-field
              v-model="code"
              label="Código (6 dígitos)"
              variant="outlined"
              prepend-inner-icon="password"
              maxlength="6"
              class="mb-1"
            />
            <v-btn type="submit" color="primary" block size="large" rounded="lg" :loading="loading" class="mt-2">Confirmar</v-btn>
            <div class="text-center mt-4 text-body-2">
              <a href="#" class="text-primary text-decoration-none font-weight-medium" @click.prevent="reenviar">Reenviar código</a>
            </div>
          </template>

          <template v-else>
            <v-text-field
              v-if="modo === 'registro'"
              v-model="name"
              label="Nome"
              variant="outlined"
              prepend-inner-icon="person"
              class="mb-3"
              hide-details
            />
            <v-select
              v-if="modo === 'registro' && !ehAdmin"
              v-model="loja"
              :items="['TNP', 'LI', 'HORA']"
              label="Sua loja"
              variant="outlined"
              prepend-inner-icon="storefront"
              class="mb-3"
              hide-details
            />
            <v-alert
              v-else-if="modo === 'registro' && ehAdmin"
              type="info"
              variant="tonal"
              density="compact"
              class="mb-3"
              text="Conta de administrador — sem loja (cadastra no catálogo Base por padrão)."
            />
            <v-text-field
              v-model="email"
              label="E-mail"
              type="email"
              variant="outlined"
              prepend-inner-icon="mail"
              class="mb-3"
              hide-details
            />
            <v-text-field
              v-model="password"
              label="Senha"
              type="password"
              variant="outlined"
              prepend-inner-icon="lock"
              class="mb-2"
              hide-details
            />
            <v-btn type="submit" color="primary" block size="large" rounded="lg" :loading="loading" class="mt-4">
              {{ botao }}
            </v-btn>
          </template>
        </v-form>

        <div v-if="modo !== 'verificar'" class="text-center mt-5 text-body-2 text-medium-emphasis">
          {{ modo === 'login' ? 'Não tem conta?' : 'Já tem conta?' }}
          <a
            href="#"
            class="text-primary text-decoration-none font-weight-medium ml-1"
            @click.prevent="modo = modo === 'login' ? 'registro' : 'login'"
          >
            {{ modo === 'login' ? 'Criar uma' : 'Entrar' }}
          </a>
        </div>
      </v-card-text>
    </v-card>
  </div>
</template>
