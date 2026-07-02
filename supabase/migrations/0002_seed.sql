-- ============================================================
-- 初期シードデータ (UIから変更可能な既定値)
-- ============================================================

-- アプリ設定既定値
insert into app_settings (key, value) values
  ('store_currency',        '"USD"'),
  ('fx_rate_jpy_per_store', '155'),          -- 1ストア通貨あたりのJPY (例: 1USD=155JPY)
  ('payment_fee_rate',      '0.044'),        -- 決済手数料率 (Shopify Payments越境目安)
  ('target_margin_rate',    '0.30'),         -- 目標粗利率
  ('domestic_shipping_jpy', '800'),          -- 国内送料 (メルカリ→自宅/倉庫)
  ('default_carrier',       '"EMS"'),
  ('volumetric_divisor',    '6000'),         -- 容積重量 (cm3 / divisor = kg)
  ('dummy_weight_values',   '[0, 1, 999, 1000, 9999]'),  -- ダミー重量とみなす値(g)。1000=Shopeeの1kgダミー
  ('preorder_note_html',
   '"<p>【予約商品 / Pre-order】ご注文確認後、日本国内で在庫を確保し2〜4週間以内に発送します。<br>This is a pre-order item. Ships from Japan within 2-4 weeks after stock confirmation.</p>"'),
  ('image_settings', '{
    "bg_removal_provider": "rembg",
    "bg_removal_model": "isnet-general-use",
    "canvas_size": 2048,
    "margin_ratio": 0.06,
    "main_background": "white",
    "sub_transparent": true,
    "watermark_enabled": false,
    "watermark_text": "",
    "lifestyle_enabled": false
  }'),
  ('shopify_settings', '{
    "vendor": "",
    "default_product_type": "Figure",
    "default_status": "draft",
    "inventory_policy": "continue",
    "weight_unit": "g",
    "output_mode": "api"
  }')
on conflict (key) do nothing;

-- カテゴリ別デフォルト重量・寸法
insert into category_defaults (category, default_weight_g, default_length_cm, default_width_cm, default_height_cm) values
  ('フィギュア',   800,  25, 20, 18),
  ('一番くじ',     600,  22, 18, 15),
  ('プライズ',     500,  22, 18, 15),
  ('ぬいぐるみ',   400,  30, 25, 20),
  ('文具',         150,  25, 18, 5),
  ('カード',       100,  20, 15, 3),
  ('その他',       500,  25, 20, 15)
on conflict (category) do nothing;

-- 国際送料テーブル (EMS 2024改定 第2地帯(米国以外)ベースの目安。UIで要調整)
insert into shipping_rate_table (carrier, weight_from_g, weight_to_g, price_jpy) values
  ('EMS',     0,   500,  3900),
  ('EMS',   501,   600,  4180),
  ('EMS',   601,   700,  4460),
  ('EMS',   701,   800,  4740),
  ('EMS',   801,   900,  5020),
  ('EMS',   901,  1000,  5300),
  ('EMS',  1001,  1250,  5990),
  ('EMS',  1251,  1500,  6680),
  ('EMS',  1501,  1750,  7370),
  ('EMS',  1751,  2000,  8060),
  ('EMS',  2001,  2500,  9200),
  ('EMS',  2501,  3000, 10340),
  ('EMS',  3001,  3500, 11480),
  ('EMS',  3501,  4000, 12620),
  ('EMS',  4001,  4500, 13760),
  ('EMS',  4501,  5000, 14900),
  ('EMS',  5001,  6000, 16700),
  ('EMS',  6001,  7000, 18500),
  ('EMS',  7001,  8000, 20300),
  ('EMS',  8001,  9000, 22100),
  ('EMS',  9001, 10000, 23900);

-- コンプラ・真贋キーワード辞書
insert into compliance_keywords (keyword, flag_type, note) values
  -- ブートレグ疑い (真贋要確認)
  ('garage kit',   'bootleg_suspect', '海賊版ガレージキットの可能性'),
  ('ガレージキット', 'bootleg_suspect', '海賊版ガレージキットの可能性'),
  ('ガレキ',        'bootleg_suspect', '海賊版ガレージキットの可能性'),
  ('recast',       'bootleg_suspect', 'リキャスト(複製品)の可能性'),
  ('リキャスト',     'bootleg_suspect', 'リキャスト(複製品)の可能性'),
  ('resin kit',    'bootleg_suspect', 'レジンキットは真贋要確認'),
  ('レジンキット',   'bootleg_suspect', 'レジンキットは真贋要確認'),
  ('bootleg',      'bootleg_suspect', 'ブートレグ明記'),
  ('海賊版',        'bootleg_suspect', '海賊版明記'),
  ('コピー品',      'bootleg_suspect', 'コピー品明記'),
  ('無版権',        'bootleg_suspect', '無版権品'),
  ('中国製ノーブランド', 'bootleg_suspect', 'ノーブランド品は真贋要確認'),
  -- 禁制品・輸送制限
  ('リチウム',      'restricted_item', 'リチウム電池は国際輸送制限あり'),
  ('lithium',      'restricted_item', 'リチウム電池は国際輸送制限あり'),
  ('電池内蔵',      'restricted_item', '電池内蔵品は輸送制限の可能性'),
  ('バッテリー',    'restricted_item', 'バッテリーは輸送制限の可能性'),
  ('模造刀',        'restricted_item', '刀剣類は多くの国で輸入禁止'),
  ('日本刀',        'restricted_item', '刀剣類は多くの国で輸入禁止'),
  ('ナイフ',        'restricted_item', '刃物は輸送・輸入制限の可能性'),
  ('エアガン',      'restricted_item', '武器類は輸入禁止の可能性'),
  ('モデルガン',    'restricted_item', '武器類は輸入禁止の可能性'),
  ('スプレー',      'restricted_item', 'エアゾールは航空輸送不可'),
  ('香水',          'restricted_item', 'アルコール含有で航空輸送制限'),
  ('ライター',      'restricted_item', '可燃物は航空輸送不可')
on conflict (keyword, flag_type) do nothing;

-- 版権ワード (IP注意) : 主要IPの例。運用しながらUIで追加する
insert into compliance_keywords (keyword, flag_type, note) values
  ('ポケモン',      'ip_caution', '任天堂/ポケモン社は権利行使に積極的'),
  ('pokemon',      'ip_caution', '任天堂/ポケモン社は権利行使に積極的'),
  ('ディズニー',    'ip_caution', 'ディズニーは権利行使に積極的'),
  ('disney',       'ip_caution', 'ディズニーは権利行使に積極的'),
  ('サンリオ',      'ip_caution', 'サンリオは権利行使に積極的'),
  ('任天堂',        'ip_caution', '任天堂は権利行使に積極的'),
  ('スタジオジブリ', 'ip_caution', 'ジブリは権利行使に積極的'),
  ('ジブリ',        'ip_caution', 'ジブリは権利行使に積極的')
on conflict (keyword, flag_type) do nothing;
