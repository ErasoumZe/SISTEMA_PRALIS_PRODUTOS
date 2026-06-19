<template>
  <v-app>
    <v-main class="auth-bg">
      <slot />
    </v-main>
  </v-app>
</template>

<style scoped>
.auth-bg {
  min-height: 100vh;
  background: linear-gradient(135deg, #4a2e29 0%, #5c3a34 38%, #b65a2a 86%, #ee7a1e 120%);
}
</style>
