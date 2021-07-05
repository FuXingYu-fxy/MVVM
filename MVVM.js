class MVVM {
  constructor(options) {
    this.$el = options.el;
    this.$data = options.data;
    
    new Observer(this.$data);
    
    new Compile(this.$el, this);
    
  }
}


/**
 ******** 数据劫持 *******
 */
class Observer {
  constructor(data) {
    this.data = data;
    this.observe(this.data);
  }
  observe(obj) {
    // 劫持的目标应该是对象
    if(!obj || typeof obj !== 'object') {
      return;
    }
    Object.keys(obj).forEach(key => {
      this.dataHijacking(obj, key, obj[key]);
      // 如果是对象 深度劫持
      this.observe(obj[key]);
    })
  }
  
  /**
   *
   * @param obj 对象
   * @param key 键
   * @param value 值
   */
  dataHijacking(obj, key, value) {
    let that = this;
    // 对于每个被劫持的key，都应该收集依赖
    let dep = new Dep();
    Object.defineProperty(obj, key, {
      enumerable: true,
      configurable: true,
      get() {
        Dep.target && dep.add(Dep.target);
        return value;
      },
      set(val) {
        if(val === value) {
          return;
        }
        // 如果设置的是对象继续劫持
        that.observe(val);
        value = val;
        // dep 通知所有人 数据改变了
        dep.notify();
      }
    })
    
  }
  
}

/**
 ******** 模板编译 *******
 */
class Compile {
  constructor(el, vm) {
    this.vm = vm;
    this.el = this.isElementNode(el) ? el : document.querySelector(el);
    if(!this.el) return;
    
    // el 当作挂载的父节点，需要把其所有子节点先拿出来放到内存中
    this.fragment = this.nodeTransformFragment(this.el);
    // 编译模板
    this.compile(this.fragment, this.vm);
    // 重新挂载到父结点上
    this.el.appendChild(this.fragment);
  }
  
  isElementNode(el) {
    // 如果是元素节点 nodeType=1
    return el.nodeType === 1;
  }
  
  /**
   * 将挂载节点下的所有子节点全部放入内存fragment中, 性能提升
   * @param parentNode
   * @return {DocumentFragment}
   */
  nodeTransformFragment(parentNode) {
    let fragment = document.createDocumentFragment();
    let child;
    // 没有错, 就是赋值语句, 赋值语句会返回赋值的结果
    // noinspection JSAssignmentUsedAsCondition
    while (child = parentNode.firstChild) {
      // appendChild
      fragment.appendChild(child);
    }
    return fragment;
  }
  
  compile(fragment, vm) {
    /**
     * 需要注意的是, 会有两种编译情况:
     * 1. 元素节点
     * 2. 文本节点
     */
    let children = fragment.childNodes;
    Array.from(children).forEach(node => {
      // 判断节点类型
      if(this.isElementNode(node)) {
        // 编译元素节点, 元素节点有属性, 所以需要先编译元素节点的所有属性
        this.compileElementNodeAttributes(node);
        
        // 再递归遍历该元素节点的子节点
        this.compile(node, vm);
        
      } else {
        // 编译文本节点
        this.compileTextNode(node);
      }
    })
  }
  
  /**
   * 编译元素节点的所有属性
   * @param node
   */
  compileElementNodeAttributes(node) {
    let attrs = node.attributes
    Array.from(attrs).forEach(attr => {
      let attrName = attr.name;
      // 只对指令编译
      if(this.isDirective(attrName)) {
        // 将类似于 'v-text' => ['v', 'text']
        //        'v-model' => ['v', 'model']
        let [, type] = attrName.split('-');
        let expr = attr.value;
        /**
         * 需要注意的是, v-text 的编译 和 直接对文本节点 {{xxx}} 的编译 行为一致
         * 它们都需要在同一函数内实现, 不过细节上有差异
         * v-text 要获取表达式 直接获取该属性的 value 就可以了
         * {{xxx}} 需要用正则匹配以获取其中的表达式
         */
        CompileUtil[type]({
          node: node,
          expr: expr,
          vm: this.vm,
          mode: 'directive'
        })
      }
    })
  }
  
  isDirective(attrName) {
    return attrName.startsWith('v-');
  }
  
  /**
   * 编译文本节点
   * @param node
   */
  compileTextNode(node) {
    let expr = node.textContent;
    CompileUtil['text']({
      node: node,
      expr: expr,
      vm: this.vm,
      mode: 'content'
    })
  }
}

const CompileUtil = {
  text({node, expr, vm, mode}) {
    let updateDOM = this.updater['updateTextFn'];
    /**
     * 提取表达式, 需要判断 mode 的类型
     * 然后在 vm 对象中获取实际的数据
     */
    let value;
    if(mode === 'content') {
      // 用正则替换
      value = this.getText(expr, vm);
    } else {
      // 直接替换
      value = this.getVal(expr, vm);
    }
    // 如果是 {{name}} 这种的表达式，还需要提取出 name
    expr = expr.replace(/{{(\w+)}}/g, (matched, key) => {
      return key;
    })
    new Watcher(vm, expr, (newValue) => {
      updateDOM && updateDOM(node, newValue);
    })
    
    updateDOM && updateDOM(node, value);
  },
  
  getText(expr, vm) {
    // 匹配 {{xxx}}
    let reg = /{{(\w+)}}/g;
    return expr.replace(reg, (matched, key) => {
      /**
       * 假设 expr 是这样子 {{message}}
       * 其中 matched 是正则匹配到的内容 {{messsage}}
       * key 就是reg模式中括号内的内容 message
       */
      return this.getVal(key, vm);
    })
  },
  
  getVal(expr, vm) {
    // 获取表达式中最后一个.xxx 的值
    // message.user.name 这种表达式需要拆开 => ['message', 'user', 'name']
    expr = expr.split('.');
    return expr.reduce((pre, k) => pre[k], vm.$data);
  },
  
  setVal(expr, vm, newVal) {
    expr = expr.split('.');
    expr.reduce((pre, key, index) => {
      if(expr.length - 1 === index) {
        pre[key] = newVal;
      }
      return pre[key];
    }, vm.$data);
  },
  
  model({node, expr, vm}) {
    let updateDOM = this.updater['updateInputFn'];
    // v-model="name";
    let value = this.getVal(expr, vm);
    // Watcher的回调
    new Watcher(vm, expr, (newValue) => {
      updateDOM && updateDOM(node, newValue);
    })
    // 对 node 设置监听程序
    node.addEventListener('input', (e) => {
      // 将对象数据和视图绑定起来
      let newValue = e.target.value;
      this.setVal(expr, vm, newValue);
    })
    updateDOM && updateDOM(node, value);
  },
  
  updater: {
    updateTextFn(node, value) {
      node.textContent = value;
    },
    updateInputFn(node, value) {
      node.value = value;
    }
  }
}


/**
 * 观察模板上的每个变量
 */
class Watcher {
  constructor(vm, expr, callback) {
    this.vm = vm;
    this.expr = expr;
    this.cb = callback;
    // 先把旧值保存起来，并且因为读取了旧值，就运行了 get 函数搜集依赖
    this.value = this.get(this.vm, this.expr);
  }
  
  get(vm, expr) {
    // Watcher 自动注册到Dep上
    Dep.target = this;
    // 调用 对象属性上的 get 方法搜集依赖
    let value = this.getVal(vm, expr);
    Dep.target = null;
    // 然后移除
    return value;
  }
  
  getVal(vm, expr) {
    // 用老方法获取对象的深度属性
    expr = expr.split('.');
    return expr.reduce((pre, key) => pre[key], vm.$data);
  }
  
  // 对外暴露的方法，如果数据发生改变，就用这个方法更新
  update() {
    let newValue = this.getVal(this.vm, this.expr);
    let oldValue = this.value;
    if(newValue === oldValue) {
      return;
    }
    this.value = newValue;
    // 在Compile中注册的回调
    this.cb(newValue);
  }
}

class Dep {
  static target = null;
  constructor() {
    // 订阅列表
    this.sub = [];
  }
  add(watcher) {
    this.sub.push(watcher);
  }
  
  notify() {
    this.sub.forEach(watcher => watcher.update()) // 通知所有人数据变动了
  }
}
