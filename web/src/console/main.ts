import { ElPopover, ElSwitch } from "element-plus";
import { createApp } from "vue";
import ConsoleApp from "./ConsoleApp.vue";
import "element-plus/es/components/button/style/css";
import "element-plus/es/components/input/style/css";
import "element-plus/es/components/date-picker/style/css";
import "element-plus/es/components/select/style/css";
import "element-plus/es/components/option/style/css";
import "element-plus/es/components/segmented/style/css";
import "element-plus/es/components/popover/style/css";
import "element-plus/es/components/tooltip/style/css";
import "../../../vue/src/shared/menu/menu-chrome.css";
import "./style.css";
createApp(ConsoleApp)
  .component("ElPopover", ElPopover)
  .component("ElSwitch", ElSwitch)
  .mount("#app");
