<script setup lang="ts">
const { user, logout } = useAuth();
</script>

<template>
  <v-app>
    <v-app-bar flat color="white" border>
      <v-container class="d-flex align-center py-0">
        <v-icon color="primary" class="mr-2">mdi-package-variant-closed</v-icon>
        <span class="text-h6 font-weight-bold">Cadastro de Produtos — Pralis</span>
        <v-spacer />
        <template v-if="user">
          <v-btn variant="text" to="/" prepend-icon="mdi-view-grid">Produtos</v-btn>
          <v-menu>
            <template #activator="{ props }">
              <v-btn v-bind="props" variant="text" prepend-icon="mdi-account-circle">{{ user.name }}</v-btn>
            </template>
            <v-list density="compact">
              <v-list-item title="Sair" prepend-icon="mdi-logout" @click="logout" />
            </v-list>
          </v-menu>
        </template>
      </v-container>
    </v-app-bar>

    <v-main class="bg-grey-lighten-4">
      <v-container class="py-6">
        <NuxtPage />
      </v-container>
    </v-main>
  </v-app>
</template>
