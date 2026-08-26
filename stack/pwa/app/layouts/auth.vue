<template>
  <v-app>
    <v-main class="auth-bg">
      <slot />
    </v-main>
  </v-app>
</template>

<style scoped>
.auth-bg {
  min-height: 100dvh;
  background:
    radial-gradient(120% 80% at 50% -15%, rgb(101 21 221 / 0.08) 0%, transparent 62%),
    radial-gradient(80% 55% at 50% 115%, rgb(53 18 140 / 0.05) 0%, transparent 60%),
    var(--cx-canvas);
}
</style>
