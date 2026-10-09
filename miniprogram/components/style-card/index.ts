/**
 * 风格卡片。
 *
 * prop 叫 styleItem 而不是 style：style 是 WXML 保留的原生属性名，
 * 同名 prop 容易和行内样式混淆。
 */
Component({
  options: { addGlobalClass: true },

  properties: {
    styleItem: { type: Object, value: {} },
    /** 选中态由父级根据 styleId 比较得出，组件自己不存状态 */
    active: { type: Boolean, value: false },
  },

  methods: {
    /**
     * 从 dataset 取 id 而不是读 this.properties：
     * 后者在 Component() 的类型推导里拿不到精确类型，只能靠断言，
     * 而 dataset 的类型是显式的，改字段名编译期就能发现。
     */
    onTap(e: { currentTarget: { dataset: { id?: string } } }) {
      const id = e.currentTarget.dataset.id;
      if (!id) return;
      this.triggerEvent('select', { id });
    },
  },
});