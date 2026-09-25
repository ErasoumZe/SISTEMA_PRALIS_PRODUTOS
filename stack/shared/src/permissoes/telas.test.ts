import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { TELAS, TELAS_SEMPRE_LIBERADAS, TODAS_AS_TELAS, telaDoPath, telaPorId } from './telas';

describe('catálogo de telas', () => {
  it('não repete id nem caminho', () => {
    expect(new Set(TELAS.map((t) => t.id)).size).toBe(TELAS.length);
    expect(new Set(TELAS.map((t) => t.path)).size).toBe(TELAS.length);
  });

  it('acha a tela pelo caminho', () => {
    expect(telaDoPath('/produtos/importar-mix')?.id).toBe('importar-mix');
    expect(telaDoPath('/nao-existe')).toBeNull();
  });

  it('a barra no fim, a query e o fragmento não escapam da guarda', () => {
    /*
     * `null` aqui a guarda lê como "não é tela do catálogo, pode passar". Sem
     * normalizar, `/produtos/manutencao/` abria "ações que não têm volta" para
     * quem não tem a permissão.
     */
    expect(telaDoPath('/produtos/manutencao/')?.id).toBe('manutencao');
    expect(telaDoPath('/produtos/manutencao///')?.id).toBe('manutencao');
    expect(telaDoPath('/produtos/manutencao?x=1')?.id).toBe('manutencao');
    expect(telaDoPath('/produtos/manutencao#topo')?.id).toBe('manutencao');
    expect(telaDoPath('/')?.id).toBe('produtos');
  });

  it('toda tela sempre liberada existe no catálogo', () => {
    for (const id of TELAS_SEMPRE_LIBERADAS) expect(telaPorId(id)).toBeDefined();
  });
});

/**
 * A GUARDA CONTRA BOTÃO MORTO.
 *
 * Em 25/09/2026 a conta da loja via o botão "Importar da base" na tela de
 * produtos, clicava, e voltava para a mesma tela. A guarda de rota estava
 * certa: a permissão daquela tela estava desligada. Errado estava o botão, que
 * aparecia para todo mundo e por isso parecia quebrado.
 *
 * Este teste lê os arquivos do PWA e cobra o mínimo: quem tem link para uma
 * tela sob permissão precisa consultar `podeVer` em algum lugar do arquivo.
 *
 * É uma rede grossa de propósito. Ela não garante que CADA link foi conferido,
 * garante que o arquivo sabe que permissão existe — que é justamente o que
 * faltava. Teste de componente é quem fecha o resto, e o PWA ainda não tem.
 */
describe('link para tela sob permissão pergunta por podeVer', () => {
  const app = resolve(__dirname, '../../../pwa/app');

  const vues = (dir: string): string[] => readdirSync(dir).flatMap((nome) => {
    const caminho = resolve(dir, nome);
    if (statSync(caminho).isDirectory()) return vues(caminho);
    return nome.endsWith('.vue') ? [caminho] : [];
  });

  it('nenhum arquivo oferece caminho que a pessoa talvez não possa abrir', () => {
    const arquivos = [...vues(resolve(app, 'pages')), ...vues(resolve(app, 'layouts'))];
    expect(arquivos.length).toBeGreaterThan(5);

    const faltando: string[] = [];
    for (const arquivo of arquivos) {
      const fonte = readFileSync(arquivo, 'utf8');
      if (fonte.includes('podeVer')) continue;

      const caminhos = [...fonte.matchAll(/\bto="(\/[^"]*)"/g)].map((m) => m[1]!);
      const sobPermissao = [...new Set(caminhos)]
        .map((c) => telaDoPath(c))
        .filter((t): t is NonNullable<typeof t> => !!t && !t.sempreLiberada)
        .map((t) => t.id);

      if (sobPermissao.length) {
        faltando.push(`${arquivo.slice(app.length + 1)} -> ${[...new Set(sobPermissao)].join(', ')}`);
      }
    }
    expect(faltando).toEqual([]);
  });

  it('a tela de produtos confere a permissão de importar da base', () => {
    // o caso concreto que originou a regra acima
    const fonte = readFileSync(resolve(app, 'pages/index.vue'), 'utf8');
    expect(fonte).toContain("podeVer('importar-da-base')");
    expect(TODAS_AS_TELAS).toContain('importar-da-base');
  });
});
