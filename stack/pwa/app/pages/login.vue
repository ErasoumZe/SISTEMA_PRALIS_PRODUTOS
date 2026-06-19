<script setup lang="ts">
definePageMeta({ layout: 'auth' });

const { login, register, verify, resend, forgotPassword, resetPassword } = useAuth();
const adminEmail = (useRuntimeConfig().public.adminEmail as string).toLowerCase();
const brandLogo = '/brand/simbolo.png';

type Modo = 'login' | 'registro' | 'verificar' | 'esqueci' | 'redefinir';
const modo = ref<Modo>('login');
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

function irPara(m: Modo) {
  modo.value = m;
  erro.value = '';
  aviso.value = '';
  code.value = '';
  if (m === 'esqueci' || m === 'login') password.value = '';
}

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
    } else if (modo.value === 'verificar') {
      await verify(email.value, code.value);
      await navigateTo('/');
    } else if (modo.value === 'esqueci') {
      await forgotPassword(email.value);
      modo.value = 'redefinir';
      aviso.value = `Se a conta existir, enviamos um código para ${email.value}. Digite-o e crie uma nova senha.`;
    } else {
      await resetPassword(email.value, code.value, password.value);
      modo.value = 'login';
      password.value = '';
      code.value = '';
      aviso.value = 'Senha redefinida! Entre com a nova senha.';
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

const titulo = computed(
  () =>
    ({
      login: 'Bem-vindo de volta',
      registro: 'Crie sua conta',
      verificar: 'Confirme seu e-mail',
      esqueci: 'Recuperar senha',
      redefinir: 'Criar nova senha',
    })[modo.value],
);
const subtitulo = computed(
  () =>
    ({
      login: 'Entre para gerenciar os produtos da sua loja',
      registro: 'Preencha seus dados para começar',
      verificar: 'Digite o código que enviamos por e-mail',
      esqueci: 'Enviaremos um código para o seu e-mail',
      redefinir: 'Digite o código e a sua nova senha',
    })[modo.value],
);
const botao = computed(
  () =>
    ({
      login: 'Entrar',
      registro: 'Criar conta',
      verificar: 'Confirmar',
      esqueci: 'Enviar código',
      redefinir: 'Redefinir senha',
    })[modo.value],
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
          <!-- confirmar e-mail -->
          <template v-if="modo === 'verificar'">
            <v-text-field v-model="code" label="Código (6 dígitos)" variant="outlined" prepend-inner-icon="password" maxlength="6" class="mb-1" />
            <v-btn type="submit" color="primary" block size="large" rounded="lg" :loading="loading" class="mt-2">Confirmar</v-btn>
            <div class="text-center mt-4 text-body-2">
              <a href="#" class="text-primary text-decoration-none font-weight-medium" @click.prevent="reenviar">Reenviar código</a>
            </div>
          </template>

          <!-- recuperar senha: pedir e-mail -->
          <template v-else-if="modo === 'esqueci'">
            <v-text-field v-model="email" label="E-mail" type="email" variant="outlined" prepend-inner-icon="mail" class="mb-2" hide-details />
            <v-btn type="submit" color="primary" block size="large" rounded="lg" :loading="loading" class="mt-4">{{ botao }}</v-btn>
          </template>

          <!-- recuperar senha: código + nova senha -->
          <template v-else-if="modo === 'redefinir'">
            <v-text-field v-model="code" label="Código (6 dígitos)" variant="outlined" prepend-inner-icon="password" maxlength="6" class="mb-3" hide-details />
            <v-text-field v-model="password" label="Nova senha" type="password" variant="outlined" prepend-inner-icon="lock" class="mb-1" hide-details />
            <v-btn type="submit" color="primary" block size="large" rounded="lg" :loading="loading" class="mt-4">{{ botao }}</v-btn>
            <div class="text-center mt-4 text-body-2">
              <a href="#" class="text-primary text-decoration-none font-weight-medium" @click.prevent="reenviar">Reenviar código</a>
            </div>
          </template>

          <!-- login / registro -->
          <template v-else>
            <v-text-field v-if="modo === 'registro'" v-model="name" label="Nome" variant="outlined" prepend-inner-icon="person" class="mb-3" hide-details />
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
            <v-text-field v-model="email" label="E-mail" type="email" variant="outlined" prepend-inner-icon="mail" class="mb-3" hide-details />
            <v-text-field v-model="password" label="Senha" type="password" variant="outlined" prepend-inner-icon="lock" class="mb-1" hide-details />
            <div v-if="modo === 'login'" class="text-right mb-1">
              <a href="#" class="text-primary text-decoration-none text-caption font-weight-medium" @click.prevent="irPara('esqueci')">Esqueci a senha</a>
            </div>
            <v-btn type="submit" color="primary" block size="large" rounded="lg" :loading="loading" class="mt-3">{{ botao }}</v-btn>
          </template>
        </v-form>

        <!-- rodapé: alternar login/registro ou voltar -->
        <div v-if="modo === 'login' || modo === 'registro'" class="text-center mt-5 text-body-2 text-medium-emphasis">
          {{ modo === 'login' ? 'Não tem conta?' : 'Já tem conta?' }}
          <a href="#" class="text-primary text-decoration-none font-weight-medium ml-1" @click.prevent="irPara(modo === 'login' ? 'registro' : 'login')">
            {{ modo === 'login' ? 'Criar uma' : 'Entrar' }}
          </a>
        </div>
        <div v-else class="text-center mt-5 text-body-2">
          <a href="#" class="text-medium-emphasis text-decoration-none font-weight-medium" @click.prevent="irPara('login')">← Voltar ao login</a>
        </div>
      </v-card-text>
    </v-card>
  </div>
</template>
