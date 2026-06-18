CREATE TABLE "grupos_mercadoria" (
	"id" text PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"tipo" text NOT NULL,
	"margem_padrao" numeric(6, 4)
);
--> statement-breakpoint
CREATE TABLE "locais_venda" (
	"id" text PRIMARY KEY NOT NULL,
	"codigo" text NOT NULL,
	"setor" text
);
--> statement-breakpoint
CREATE TABLE "setores" (
	"id" text PRIMARY KEY NOT NULL,
	"nome" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '7 days' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_fiscal" (
	"product_id" text PRIMARY KEY NOT NULL,
	"ncm" text,
	"cest" text,
	"categoria" text,
	"cst_pis_cofins" text,
	"aliquota_cheia" numeric(6, 4),
	"aliquota_fcp" numeric(6, 4),
	"aliquota_pis" numeric(6, 4),
	"aliquota_cofins" numeric(6, 4),
	"reducao_icms" numeric(6, 4),
	"icms" numeric(6, 4)
);
--> statement-breakpoint
CREATE TABLE "product_transformacao" (
	"product_id" text PRIMARY KEY NOT NULL,
	"precisao" text,
	"qtd" numeric(12, 3),
	"unidade" text,
	"produto_receituario" text,
	"ref_receituario" text
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"loja" text NOT NULL,
	"codigo" text NOT NULL,
	"base_product_id" text,
	"created_by_user_id" text,
	"created_by_name" text,
	"nome" text NOT NULL,
	"quantidade" numeric(12, 3) DEFAULT '0' NOT NULL,
	"medida_base" text NOT NULL,
	"codigo_barras" text,
	"marca" text,
	"embalagem" text,
	"c_de" text,
	"qt_cad" integer DEFAULT 1 NOT NULL,
	"medida_compra" text,
	"codigo_interno" text,
	"foto_url" text,
	"grupo" text,
	"tipo" text NOT NULL,
	"status" text DEFAULT 'ativo' NOT NULL,
	"habilitar_ajuda" boolean DEFAULT false NOT NULL,
	"estoque_min" numeric(12, 3),
	"estoque_max" numeric(12, 3),
	"setor_estoque" text,
	"custo" numeric(12, 2),
	"margem_pontual" numeric(6, 4),
	"v_venda_pontual" numeric(12, 2),
	"auto" boolean DEFAULT false NOT NULL,
	"local_venda_1" text,
	"local_venda_2" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promocoes" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"tipo" text NOT NULL,
	"valor" numeric(12, 2),
	"desconto_pct" numeric(6, 4),
	"hora_inicio" text,
	"hora_fim" text,
	"seg" boolean DEFAULT false NOT NULL,
	"ter" boolean DEFAULT false NOT NULL,
	"qua" boolean DEFAULT false NOT NULL,
	"qui" boolean DEFAULT false NOT NULL,
	"sex" boolean DEFAULT false NOT NULL,
	"sab" boolean DEFAULT false NOT NULL,
	"dom" boolean DEFAULT false NOT NULL,
	"desconto_ate" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"loja" text NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"verification_code" text,
	"verification_expires_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_fiscal" ADD CONSTRAINT "product_fiscal_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_transformacao" ADD CONSTRAINT "product_transformacao_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promocoes" ADD CONSTRAINT "promocoes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_products_loja" ON "products" USING btree ("loja");