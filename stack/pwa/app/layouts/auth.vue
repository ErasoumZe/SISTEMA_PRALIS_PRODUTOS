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
  background: linear-gradient(135deg, #0f172a 0%, #4c1d95 55%, #7c3aed 100%);
}
</style>
