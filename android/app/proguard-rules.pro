# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
-renamesourcefileattribute SourceFile

# R8 ligado (regra de qualidade da Google Play, fev/2027). O Capacitor acha os plugins e as permissões
# por reflexão (anotações @CapacitorPlugin/@Permission lidas em tempo de execução): sem estas regras o
# R8 renomeia o núcleo do Capacitor e corta as anotações — a câmera (Digitalizar) fechava o app com
# NullPointerException em getPermissionStates. Mesmo conjunto que o Physiq usa em produção.
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod
-keep class com.getcapacitor.** { *; }
-keep class com.capacitorjs.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keep class org.apache.cordova.** { *; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.bertoldo.pdfbox.** { *; }
