-- =====================================================================
-- 16_seed_demo.sql   (OPCIONAL - solo para demos/pruebas)
-- Productos, clientes, proveedores y 2 sedes de ejemplo con stock inicial
-- repartido entre las sedes. No ejecutar en producción real.
-- Requiere haber ejecutado 01..15.
-- =====================================================================

insert into public.sedes (codigo, nombre, direccion, telefono) values
  ('TN', 'Tienda Norte', 'Av. Los Andes 458', '987 300 400'),
  ('TS', 'Tienda Sur',   'Jr. Progreso 890',  '987 500 600')
on conflict do nothing;

insert into public.proveedores (nombre, ruc, telefono) values
  ('Distribuidora Andina SAC', '20512345671', '01 555 0101'),
  ('Comercial del Sur EIRL',   '20512345672', '01 555 0102'),
  ('Bebidas del Norte SAC',    '20512345673', '01 555 0103'),
  ('Lácteos Unidos SA',        '20512345674', '01 555 0104')
on conflict do nothing;

insert into public.clientes (documento, nombre, telefono, email, direccion, tipo) values
  ('45872136', 'María Fernández', '987 654 321', 'maria.fernandez@correo.com', 'Av. Los Álamos 245', 'vip'),
  ('40125876', 'Carlos Ramírez',  '912 345 678', 'carlos.ramirez@correo.com',  'Jr. Puno 118',        'regular'),
  ('73215489', 'Ana Torres',      '956 789 123', 'ana.torres@correo.com',      'Calle Lima 903',      'vip'),
  ('44556677', 'Luis Mendoza',    '934 567 890', 'luis.mendoza@correo.com',    'Av. Grau 452',        'regular'),
  ('41237896', 'Rosa Quispe',     '978 123 456', 'rosa.quispe@correo.com',     'Jr. Amazonas 77',     'regular'),
  ('45678912', 'Jorge Salazar',   '965 432 187', 'jorge.salazar@correo.com',   'Av. Brasil 1580',     'vip'),
  ('70123456', 'Elena Rojas',     '943 210 876', 'elena.rojas@correo.com',     'Calle San Martín 321','regular'),
  ('40987654', 'Pedro Castillo',  '921 876 543', 'pedro.castillo@correo.com',  'Jr. Cusco 654',       'regular')
on conflict do nothing;

-- Productos (stock_total se reparte entre las sedes como stock inicial)
do $$
declare
  r record; v_sedes uuid[]; v_n int; v_base numeric; v_resto int; i int; v_pid uuid; v_cat uuid; v_cant numeric;
begin
  select array_agg(id order by numero) into v_sedes from public.sedes where activa;
  v_n := array_length(v_sedes, 1);

  for r in select * from (values
    ('779001','Arroz Extra 5kg',      'Arroz extra seleccionado',        'Abarrotes',        24.90, 19.50, 120, 20, 'Bolsa',   true),
    ('779002','Aceite Vegetal 1L',    'Aceite vegetal refinado',         'Abarrotes',         9.50,  7.20,  85, 15, 'Botella', true),
    ('779003','Leche Entera 1L',      'Leche entera UHT',                'Lácteos',           4.80,  3.60,  40, 25, 'Caja',    true),
    ('779004','Gaseosa 3L',           'Bebida gaseosa familiar',         'Bebidas',           8.90,  6.40,  12, 18, 'Botella', true),
    ('779005','Agua Mineral 625ml',   'Agua mineral sin gas',            'Bebidas',           1.50,  0.90, 240, 40, 'Botella', true),
    ('779006','Detergente 900g',      'Detergente en polvo',             'Limpieza',         11.90,  8.50,  55, 12, 'Bolsa',   true),
    ('779007','Papel Higiénico x4',   'Papel higiénico doble hoja',      'Limpieza',          7.50,  5.10,   8, 20, 'Paquete', true),
    ('779008','Galletas Surtidas',    'Galletas de diferentes sabores',  'Snacks',            2.20,  1.40, 180, 30, 'Unidad',  true),
    ('779009','Chocolate Barra',      'Chocolate con leche',             'Snacks',            3.50,  2.10,  96, 24, 'Unidad',  true),
    ('779010','Shampoo 750ml',        'Shampoo para cabello normal',     'Cuidado Personal', 15.90, 11.20,  30, 10, 'Botella', true),
    ('779011','Jabón de Tocador',     'Jabón hidratante',                'Cuidado Personal',  2.80,  1.70,  64, 20, 'Unidad',  true),
    ('779012','Azúcar Rubia 1kg',     'Azúcar rubia doméstica',          'Abarrotes',         5.40,  4.10,   0, 15, 'Bolsa',   false)
  ) as t(codigo, nombre, descripcion, categoria, pv, pc, stock_total, minimo, unidad, activo)
  loop
    select id into v_cat from public.categorias where lower(nombre) = lower(r.categoria);
    insert into public.productos (codigo, nombre, descripcion, categoria_id, precio_venta, precio_compra, stock_minimo, unidad, activo)
    values (r.codigo, r.nombre, r.descripcion, v_cat, r.pv, r.pc, ceil(r.minimo::numeric / v_n), r.unidad, r.activo)
    on conflict (codigo) do nothing
    returning id into v_pid;

    if v_pid is not null and r.stock_total > 0 then
      v_base  := floor(r.stock_total::numeric / v_n);
      v_resto := r.stock_total % v_n;
      for i in 1..v_n loop
        v_cant := v_base + (case when i <= v_resto then 1 else 0 end);
        if v_cant > 0 then
          perform public.registrar_movimiento(v_sedes[i], v_pid, v_cant,
                    'entrada', 'stock_inicial', 'Stock inicial (datos demo)', 'INICIAL');
        end if;
      end loop;
    end if;
    v_pid := null;
  end loop;
end $$;
