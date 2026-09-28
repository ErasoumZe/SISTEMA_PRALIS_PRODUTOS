import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * A GUARDA CONTRA O `<template>` INERTE.
 *
 * Em 28/09/2026 o bloco de estoque, custo e preço sumiu da tela de editar
 * produto. A causa foi um `<template>` sem diretiva envolvendo o bloco: no
 * Vue 3 isso vira um elemento HTML `<template>` de verdade, cujo conteúdo o
 * navegador não renderiza. O build passou, nenhum erro apareceu, e a tela
 * simplesmente perdeu um pedaço.
 *
 * Dentro do corpo de um componente, `<template>` só faz sentido com `v-if`,
 * `v-else`, `v-for` ou `v-slot`/`#nome`. O da raiz do arquivo é o único sem
 * diretiva permitido, e ele nunca é indentado.
 */
describe('nenhum <template> sem diretiva dentro de componente', () => {
  const app = resolve(__dirname, '../../../pwa/app');
  const vues = (dir: string): string[] => readdirSync(dir).flatMap((nome) => {
    const caminho = resolve(dir, nome);
    if (statSync(caminho).isDirectory()) return vues(caminho);
    return nome.endsWith('.vue') ? [caminho] : [];
  });

  it('todo <template> indentado carrega v-if, v-else, v-for ou slot', () => {
    const arquivos = [...vues(resolve(app, 'pages')), ...vues(resolve(app, 'components')), ...vues(resolve(app, 'layouts'))];
    expect(arquivos.length).toBeGreaterThan(5);
    const inertes: string[] = [];
    for (const arquivo of arquivos) {
      readFileSync(arquivo, 'utf8').split(/\r?\n/).forEach((linha, i) => {
        // indentado = dentro do componente; o da raiz começa na coluna 0
        if (/^\s+<template>\s*$/.test(linha)) inertes.push(`${arquivo.slice(app.length + 1)}:${i + 1}`);
      });
    }
    expect(inertes).toEqual([]);
  });
});
